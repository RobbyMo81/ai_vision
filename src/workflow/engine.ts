/**
 * Workflow execution engine.
 *
 * Executes a WorkflowDefinition step-by-step, routing each step to the
 * appropriate underlying capability:
 *
 *   navigate / click / type / screenshot  → SessionManager (direct Playwright)
 *   extract                               → Stagehand page.extract()
 *   agent_task                            → Router → best engine for the prompt
 *   human_takeover                        → HitlCoordinator (blocks until user returns)
 *   conditional                           → Stagehand page.extract() → evaluate → recurse
 *
 * The engine is stateless between runs — all browser state lives in SessionManager.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { sessionManager } from '../session/manager';
import { hitlCoordinator } from '../session/hitl';
import { SessionState, TaskPhase } from '../session/types';
import { EngineId } from '../engines/interface';
import {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowResult,
  StepResult,
  AgentTaskStep,
} from './types';
import { registry } from '../engines/registry';

// ---------------------------------------------------------------------------
// Intelligent router
// ---------------------------------------------------------------------------

/**
 * Given a task prompt and the set of available engines, pick the most
 * appropriate engine.
 *
 * Heuristics (in priority order):
 *   1. Long, exploratory, multi-page tasks        → browser-use  (agent loop)
 *   2. Structured SOPs / form-filling workflows   → skyvern      (workflow engine)
 *   3. Precision single-page UI actions           → stagehand    (page.act)
 *   4. Default                                    → stagehand    (most reliable)
 */
export async function routeAgentTask(prompt: string, preferredEngine: AgentTaskStep['engine'] = 'auto'): Promise<EngineId> {
  if (preferredEngine && preferredEngine !== 'auto') return preferredEngine as EngineId;

  const lower = prompt.toLowerCase();

  // SOP / workflow signals
  const skyvernSignals = ['complete all steps', 'follow the process', 'fill out the form', 'submit the', 'workflow'];
  if (skyvernSignals.some((s) => lower.includes(s))) {
    const available = await registry.get('skyvern').available();
    if (available) return 'skyvern';
  }

  // Exploratory / multi-step agent signals
  const browserUseSignals = ['find', 'search', 'navigate to', 'look for', 'browse', 'check all', 'go through'];
  if (browserUseSignals.some((s) => lower.includes(s))) {
    return 'browser-use';
  }

  // Default: stagehand (most reliable for single-page precision tasks)
  return 'stagehand';
}

// ---------------------------------------------------------------------------
// Parameter substitution
// ---------------------------------------------------------------------------

function substitute(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const val = params[key];
    if (val === undefined || val === null || val === '') return '';
    return String(val);
  });
}

function substituteStep(step: WorkflowStep, params: Record<string, unknown>): WorkflowStep {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(step)) {
    if (typeof v === 'string') {
      result[k] = substitute(v, params);
    } else if (Array.isArray(v)) {
      result[k] = v.map((item) =>
        typeof item === 'object' && item !== null
          ? substituteStep(item as WorkflowStep, params)
          : item
      );
    } else {
      result[k] = v;
    }
  }
  return result as WorkflowStep;
}

// ---------------------------------------------------------------------------
// Step executor
// ---------------------------------------------------------------------------

async function executeStep(
  step: WorkflowStep,
  params: Record<string, unknown>,
  screenshots: WorkflowResult['screenshots'],
  outputs: Record<string, string>,
  onStateUpdate: (state: Partial<SessionState>) => void,
): Promise<StepResult> {
  const start = Date.now();
  const sub = substituteStep(step, params);

  try {
    switch (sub.type) {
      // ----- navigate -------------------------------------------------------
      case 'navigate': {
        await sessionManager.navigate(sub.url, sub.waitUntil ?? 'load');
        return { stepId: sub.id, success: true, durationMs: Date.now() - start };
      }

      // ----- click ----------------------------------------------------------
      case 'click': {
        await sessionManager.click(sub.selector);
        return { stepId: sub.id, success: true, durationMs: Date.now() - start };
      }

      // ----- type -----------------------------------------------------------
      case 'type': {
        await sessionManager.type(sub.selector, sub.text, sub.clearFirst);
        return { stepId: sub.id, success: true, durationMs: Date.now() - start };
      }

      // ----- screenshot -----------------------------------------------------
      case 'screenshot': {
        const b64 = await sessionManager.screenshot();
        const screenshotDir = path.join(process.env.SESSION_DIR ?? './sessions', 'workflow');
        fs.mkdirSync(screenshotDir, { recursive: true });
        const filePath = path.join(screenshotDir, `${sub.id}-${Date.now()}.jpg`);
        fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
        screenshots.push({ path: filePath, base64: b64, stepId: sub.id });
        if (sub.outputKey) outputs[sub.outputKey] = filePath;
        return { stepId: sub.id, success: true, screenshotPath: filePath, screenshotBase64: b64, durationMs: Date.now() - start };
      }

      // ----- extract --------------------------------------------------------
      case 'extract': {
        // Read page content from the SHARED SessionManager browser (preserves auth state).
        // We return the raw page text tagged with the instruction — the MCP caller (Claude)
        // processes it to find the specific value.  This avoids the session-sharing problem
        // of delegating to Stagehand, which manages its own separate browser instance.
        const page = await sessionManager.getPage();
        const pageText: string = await page.evaluate(() =>
          (document.body as HTMLElement).innerText.replace(/\s{3,}/g, '\n').trim()
        );
        const result = `[Extract instruction: ${sub.instruction}]\n\n${pageText.slice(0, 4000)}`;
        outputs[sub.outputKey] = result;
        return { stepId: sub.id, success: true, output: result, durationMs: Date.now() - start };
      }

      // ----- agent_task -----------------------------------------------------
      case 'agent_task': {
        const engineId = await routeAgentTask(sub.prompt, sub.engine);
        onStateUpdate({ currentStep: `${sub.id} → ${engineId}` });

        // For agent engines that manage their own browser (browser-use, skyvern),
        // inject the current browser cookies so auth state is preserved.
        // Stagehand is special: we run it on the EXISTING SessionManager page.
        if (engineId === 'stagehand') {
          const engine = await registry.getReady('stagehand');
          const taskResult = await engine.runTask(sub.prompt);
          return {
            stepId: sub.id,
            success: taskResult.success,
            output: taskResult.output,
            error: taskResult.error,
            durationMs: Date.now() - start,
          };
        } else {
          // browser-use / skyvern: inject cookies then run task
          const cookies = await sessionManager.extractCookies();
          const engine = await registry.getReady(engineId);
          // Pass cookies as part of context (engines will inject them when supported)
          const taskResult = await engine.runTask(sub.prompt, { cookies });
          return {
            stepId: sub.id,
            success: taskResult.success,
            output: taskResult.output,
            error: taskResult.error,
            durationMs: Date.now() - start,
          };
        }
      }

      // ----- human_takeover -------------------------------------------------
      case 'human_takeover': {
        onStateUpdate({ phase: 'awaiting_human', hitlReason: sub.reason, hitlInstructions: sub.instructions });
        await hitlCoordinator.requestTakeover(sub.reason, sub.instructions);
        onStateUpdate({ phase: 'running', hitlReason: undefined, hitlInstructions: undefined });
        return { stepId: sub.id, success: true, durationMs: Date.now() - start };
      }

      // ----- conditional ----------------------------------------------------
      case 'conditional': {
        // Evaluate condition from shared-session page content (not Stagehand's separate browser)
        const page = await sessionManager.getPage();
        const pageText: string = await page.evaluate(() =>
          (document.body as HTMLElement).innerText.replace(/\s{3,}/g, '\n').trim()
        );
        // Simple heuristic: check if condition keyword appears in the page text.
        // For more sophisticated evaluation, the agent_task step with a short prompt works better.
        const condKeyword = sub.condition.replace(/\?$/, '').toLowerCase().trim();
        const condResult = pageText.toLowerCase().includes(condKeyword) ? 'yes' : 'no';
        const isTrue = condResult.toLowerCase().trim().startsWith('yes');
        const branchSteps = isTrue ? sub.ifTrue : (sub.ifFalse ?? []);

        for (const branchStep of branchSteps) {
          const stepResult = await executeStep(branchStep, params, screenshots, outputs, onStateUpdate);
          if (!stepResult.success) return stepResult;
        }
        return { stepId: sub.id, success: true, output: `condition=${isTrue}`, durationMs: Date.now() - start };
      }

      default:
        return {
          stepId: (step as { id: string }).id,
          success: false,
          error: `Unknown step type: ${(step as { type: string }).type}`,
          durationMs: Date.now() - start,
        };
    }
  } catch (e) {
    return {
      stepId: step.id,
      success: false,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// WorkflowEngine
// ---------------------------------------------------------------------------

export class WorkflowEngine {
  private _currentState: SessionState | null = null;

  get currentState(): SessionState | null {
    return this._currentState;
  }

  async run(
    definition: WorkflowDefinition,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<WorkflowResult> {
    const workflowStart = Date.now();
    const id = sessionId ?? `wf-${Date.now()}`;
    const stepResults: StepResult[] = [];
    const screenshots: WorkflowResult['screenshots'] = [];
    const outputs: Record<string, string> = {};

    // Validate and apply defaults to params
    const resolvedParams: Record<string, unknown> = { ...params };
    for (const [key, def] of Object.entries(definition.params ?? {})) {
      if (resolvedParams[key] === undefined) {
        if (def.default !== undefined) {
          resolvedParams[key] = def.default;
        } else if (def.required !== false) {
          return {
            workflowId: definition.id,
            success: false,
            stepResults: [],
            outputs: {},
            screenshots: [],
            durationMs: 0,
            error: `Missing required parameter: '${key}'`,
          };
        }
      }
    }

    // Ensure the browser session is running
    await sessionManager.start();
    hitlCoordinator.setPhase('running');

    const onStateUpdate = (partial: Partial<SessionState>): void => {
      this._currentState = {
        id,
        phase: 'running',
        startedAt: new Date(workflowStart),
        lastUpdatedAt: new Date(),
        ...this._currentState,
        ...partial,
      };
      hitlCoordinator.emit('phase_changed', this._currentState);
    };

    onStateUpdate({
      id,
      phase: 'running',
      totalSteps: definition.steps.length,
      completedSteps: 0,
      startedAt: new Date(workflowStart),
      lastUpdatedAt: new Date(),
    });

    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      onStateUpdate({
        currentStep: step.id,
        stepIndex: i + 1,
        completedSteps: i,
        currentUrl: await sessionManager.currentUrl().catch(() => undefined),
      });

      const result = await executeStep(step, resolvedParams, screenshots, outputs, onStateUpdate);
      stepResults.push(result);

      if (!result.success) {
        hitlCoordinator.setPhase('error');
        onStateUpdate({ phase: 'error', error: result.error });
        return {
          workflowId: definition.id,
          success: false,
          stepResults,
          outputs,
          screenshots,
          durationMs: Date.now() - workflowStart,
          error: `Step '${step.id}' failed: ${result.error}`,
        };
      }
    }

    hitlCoordinator.setPhase('complete');
    onStateUpdate({ phase: 'complete', completedSteps: definition.steps.length });

    return {
      workflowId: definition.id,
      success: true,
      stepResults,
      outputs,
      screenshots,
      durationMs: Date.now() - workflowStart,
    };
  }
}

export const workflowEngine = new WorkflowEngine();
