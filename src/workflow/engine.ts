/**
 * Workflow execution engine.
 *
 * Executes a WorkflowDefinition step-by-step, routing each step to the
 * appropriate underlying capability:
 *
 *   navigate / click / type / screenshot  → SessionManager (direct Playwright)
 *   extract                               → SessionManager page.evaluate
 *   agent_task                            → Router → best engine for the prompt
 *   human_takeover                        → HitlCoordinator (blocks until user returns)
 *
 * MEMORY INTEGRATION
 * ------------------
 * Short-term memory is accumulated across steps within a single run.
 * Before each agent_task the prompt is prefixed with:
 *   1. SIC block    — validated best practices from long-term memory
 *   2. Session ctx  — what was already completed this run (prevents re-work)
 *   3. Output fmt   — instructions to emit a MEMORY_UPDATE block so the next
 *                     step knows what was confirmed filled
 *
 * At workflow end a Story is written to long-term memory, and any improvements
 * observed during the run are recorded (incrementing occurrence counts toward
 * SIC promotion at 10 occurrences).
 */

import * as path from 'path';
import * as fs from 'fs';
import { sessionManager } from '../session/manager';
import { hitlCoordinator } from '../session/hitl';
import { SessionState } from '../session/types';
import { EngineId } from '../engines/interface';
import {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowResult,
  StepResult,
  AgentTaskStep,
} from './types';
import { getGeminiWriter } from '../content/gemini-writer';
import type { SocialPublishOutcome } from '../session/types';
import { registry } from '../engines/registry';
import {
  shortTermMemory,
  longTermMemory,
  memoryIndexer,
  parseMemoryUpdate,
  buildFallbackMemory,
  ShortTermMemoryManager,
  Story,
} from '../memory';
import { wrapUpWorkflowRun } from './wrap-up';
import { telemetry } from '../telemetry';

// ---------------------------------------------------------------------------
// Intelligent router
// ---------------------------------------------------------------------------

/**
 * Pick the best engine for a given agent task prompt.
 *
 *   Exploratory multi-page tasks          → browser-use  (agent loop)
 *   Structured SOPs / form workflows      → skyvern      (workflow engine)
 *   Precision single-page UI actions      → stagehand    (page.act)
 *   Default                               → stagehand
 */
export async function routeAgentTask(
  prompt: string,
  preferredEngine: AgentTaskStep['engine'] = 'auto',
): Promise<EngineId> {
  if (preferredEngine && preferredEngine !== 'auto') return preferredEngine as EngineId;

  const lower = prompt.toLowerCase();

  const skyvernSignals = ['complete all steps', 'follow the process', 'fill out the form', 'submit the', 'workflow'];
  if (skyvernSignals.some(s => lower.includes(s))) {
    const available = await registry.get('skyvern').available();
    if (available) return 'skyvern';
  }

  const browserUseSignals = ['find', 'search', 'navigate to', 'look for', 'browse', 'check all', 'go through', 'fill out'];
  if (browserUseSignals.some(s => lower.includes(s))) {
    return 'browser-use';
  }

  return 'stagehand';
}

// ---------------------------------------------------------------------------
// Parameter substitution
// ---------------------------------------------------------------------------

function substitute(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const val = params[key];
    return val === undefined || val === null || val === '' ? '' : String(val);
  });
}

function substituteStep(step: WorkflowStep, params: Record<string, unknown>): WorkflowStep {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(step)) {
    if (typeof v === 'string') {
      result[k] = substitute(v, params);
    } else if (Array.isArray(v)) {
      result[k] = v.map(item =>
        typeof item === 'object' && item !== null
          ? substituteStep(item as WorkflowStep, params)
          : item,
      );
    } else {
      result[k] = v;
    }
  }
  return result as WorkflowStep;
}

function buildRuntimeParams(
  resolvedParams: Record<string, unknown>,
  outputs: Record<string, string>,
): Record<string, unknown> {
  return {
    ...resolvedParams,
    ...outputs,
  };
}

// ---------------------------------------------------------------------------
// Memory-enhanced prompt builder
// ---------------------------------------------------------------------------

/**
 * Wrap a raw agent_task prompt with:
 *   [SIC block]        — proven best-practices from long-term memory
 *   [Session memory]   — what this workflow already completed
 *   [Original prompt]
 *   [Output format]    — request for structured MEMORY_UPDATE at end of response
 */
function buildEnhancedPrompt(
  rawPrompt: string,
  memorySection: string,
  guardedFields: string[] = [],
): string {
  const sicBlock = longTermMemory.getSicPromptBlock();
  const sessionCtx = shortTermMemory.getContextPrompt();
  const outputFmt = ShortTermMemoryManager.getOutputFormatInstruction(memorySection);
  const guardedBlock = guardedFields.length > 0
    ? [
        '=== HITL-CONTROLLED SENSITIVE FIELDS ===',
        `Do not request, inspect, or modify these fields: ${guardedFields.join(', ')}.`,
        'Assume HITL already handled them unless explicitly told otherwise.',
        '=== END HITL-CONTROLLED SENSITIVE FIELDS ===\n',
      ].join('\n')
    : '';

  return [sicBlock, sessionCtx, guardedBlock, rawPrompt, outputFmt]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Improvement seeds — known patterns recorded from the DOT form run
// ---------------------------------------------------------------------------

/**
 * Record known improvements that we've already observed empirically.
 * Called once per workflow run so occurrence counts accumulate across runs.
 */
function seedKnownImprovements(workflowId: string): void {
  longTermMemory.recordImprovement({
    id: 'salesforce-dropdown-click-wait-select',
    category: 'dropdown',
    title: 'Salesforce dropdown: click → wait → select',
    description:
      'Salesforce Experience Cloud dropdowns do not respond reliably to ' +
      'direct select_dropdown calls. The agent must click the field, wait ' +
      '500-1000ms for the overlay to appear, then select the value. ' +
      'Re-selecting multiple times without this pattern results in persistent ' +
      '"Please select a choice" validation errors.',
    agentInstruction:
      'For any dropdown on a Salesforce/Experience Cloud form: ' +
      '(1) click the dropdown element, (2) wait 1 second, ' +
      '(3) select the desired value. Never use select_dropdown without clicking first.',
    workflowId,
  });

  longTermMemory.recordImprovement({
    id: 'autocomplete-full-name-not-code',
    category: 'autocomplete',
    title: 'Autocomplete fields: type full name, not code',
    description:
      'Airport and airline autocomplete fields on the DOT OACP form require ' +
      'the full city or airline name to trigger suggestions. Typing IATA codes ' +
      '(e.g. "SAN", "SEA", "AS") results in "Enter a valid value" errors. ' +
      'After typing, wait 2 seconds for the suggestion list before clicking.',
    agentInstruction:
      'For airport autocomplete fields: type the full city name (e.g. "San Diego", ' +
      '"Seattle") and wait 2 seconds for suggestions before clicking. ' +
      'Do NOT type IATA codes directly.',
    workflowId,
  });

  longTermMemory.recordImprovement({
    id: 'dont-re-select-confirmed-fields',
    category: 'form-validation',
    title: 'Do not re-select fields confirmed in SESSION MEMORY',
    description:
      'Agent repeatedly re-visited dropdown fields already filled in earlier ' +
      'steps, causing unnecessary delays and sometimes resetting values. ' +
      'The SESSION MEMORY block lists confirmed fields — these must not be touched.',
    agentInstruction:
      'Never re-fill or re-select a field listed under COMPLETED FIELDS in the ' +
      'SESSION MEMORY block. Trust that confirmed fields are correct and skip them.',
    workflowId,
  });
}

function recordFinalConfirmationSelfHeal(
  workflowId: string,
  stepId: string,
  reason: string,
): void {
  longTermMemory.recordImprovement({
    id: `final-confirmation-rejected-${workflowId}-${stepId}`,
    category: 'general',
    title: `Final-step rejection for ${stepId}`,
    description:
      `HITL rejected the final outcome for step "${stepId}" in workflow "${workflowId}". ` +
      `Reason: ${reason}`,
    agentInstruction:
      'For any irreversible final action, do not assume completion from a click alone. ' +
      'Verify visible success evidence first, then hand off to HITL for confirmation. ' +
      'If success evidence is missing, report the failure explicitly instead of proceeding.',
    workflowId,
  });
}

// ---------------------------------------------------------------------------
// Social publish outcome classifier
// ---------------------------------------------------------------------------

const SOCIAL_WORKFLOW_IDS = new Set([
  'post_to_x',
  'write_and_post_to_x',
  'post_to_reddit',
  'write_and_post_to_reddit',
]);

function isSocialWorkflow(workflowId: string): boolean {
  return SOCIAL_WORKFLOW_IDS.has(workflowId);
}

function isEditorialMessageParam(paramKey: string): boolean {
  return [
    'post_text',
    'post_title',
    'x_post_text',
    'reddit_post_text',
    'reddit_post_title',
  ].includes(paramKey);
}

function hasUserProvidedEditorialMessage(params: Record<string, unknown>): boolean {
  const candidateKeys = [
    'post_text',
    'post_title',
    'x_post_text',
    'reddit_post_text',
    'reddit_post_title',
  ];

  return candidateKeys.some((key) => {
    const value = params[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function detectSocialPlatform(workflowId: string): 'x' | 'reddit' | 'linkedin' {
  if (workflowId.includes('reddit')) return 'reddit';
  if (workflowId.includes('linkedin')) return 'linkedin';
  return 'x';
}

function resolveEditorialTopic(
  definition: WorkflowDefinition,
  params: Record<string, unknown>,
): string {
  const candidates = [
    params.topic,
    params.task,
    params.context,
    params.post_title,
    params.post_text,
    params.reddit_post_title,
    params.reddit_post_text,
    definition.description,
    definition.name,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return `Create a ${detectSocialPlatform(definition.id)} social post for workflow ${definition.id}.`;
}

async function bootstrapEditorialDraft(
  definition: WorkflowDefinition,
  resolvedParams: Record<string, unknown>,
  outputs: Record<string, string>,
  onStateUpdate: (state: Partial<SessionState>) => void,
  telemetryContext: { sessionId: string; workflowId: string },
): Promise<void> {
  if (!isSocialWorkflow(definition.id)) {
    telemetry.emit({
      source: 'workflow',
      name: 'workflow.content.bootstrap.skipped',
      sessionId: telemetryContext.sessionId,
      workflowId: telemetryContext.workflowId,
      details: {
        reason: 'not_social_workflow',
      },
    });
    return;
  }

  if (hasUserProvidedEditorialMessage(resolvedParams)) {
    telemetry.emit({
      source: 'workflow',
      name: 'workflow.content.bootstrap.skipped',
      sessionId: telemetryContext.sessionId,
      workflowId: telemetryContext.workflowId,
      details: {
        reason: 'user_provided_message',
      },
    });
    return;
  }

  const writer = getGeminiWriter();
  const platform = detectSocialPlatform(definition.id);
  const includeTitle = platform === 'reddit';
  const topic = resolveEditorialTopic(definition, resolvedParams);
  const tone = typeof resolvedParams.tone === 'string'
    ? resolvedParams.tone as 'factual' | 'conversational' | 'professional' | 'direct'
    : 'conversational';

  telemetry.emit({
    source: 'workflow',
    name: 'workflow.content.bootstrap.started',
    sessionId: telemetryContext.sessionId,
    workflowId: telemetryContext.workflowId,
    details: {
      platform,
      includeTitle,
      topicLength: topic.length,
    },
  });

  const generated = await writer.writePost({
    platform,
    topic,
    context: typeof resolvedParams.context === 'string' ? resolvedParams.context : undefined,
    tone,
    includeTitle,
  });

  if (platform === 'reddit') {
    if (generated.title) {
      resolvedParams.post_title = generated.title;
      resolvedParams.reddit_post_title = generated.title;
      outputs.reddit_post_title = generated.title;
    }
    resolvedParams.post_text = generated.text;
    resolvedParams.reddit_post_text = generated.text;
    outputs.post_text = generated.text;
    outputs.reddit_post_text = generated.text;
  } else {
    resolvedParams.post_text = generated.text;
    resolvedParams.x_post_text = generated.text;
    outputs.post_text = generated.text;
    outputs.x_post_text = generated.text;
  }

  shortTermMemory.addScratchNote(
    `GeminiWriter generated editorial draft during pre-flight for ${definition.id}.`,
  );

  telemetry.emit({
    source: 'workflow',
    name: 'workflow.content.bootstrap.completed',
    sessionId: telemetryContext.sessionId,
    workflowId: telemetryContext.workflowId,
    details: {
      platform,
      model: generated.model,
      hasTitle: Boolean(generated.title),
      bodyLength: generated.text.length,
    },
  });

  if (!process.env.AI_VISION_UI_PORT) {
    throw new Error(
      'GeminiWriter drafted content, but HITL review is required before posting and AI_VISION_UI_PORT is not set.',
    );
  }

  const preview = generated.title
    ? `TITLE: ${generated.title}\nBODY: ${generated.text}`
    : generated.text;

  const reviewReason = 'Editor-in-Chief review required: GeminiWriter draft pending approval';
  const reviewInstructions = [
    'Review the generated message below. Edit directly in the browser later if needed.',
    'Only continue when this message is approved as Ready for Posting.',
    '',
    preview.slice(0, 1600),
  ].join('\n');

  onStateUpdate({
    phase: 'hitl_qa',
    hitlAction: 'capture_notes',
    hitlReason: reviewReason,
    hitlInstructions: reviewInstructions,
  });

  await hitlCoordinator.requestQaPause(
    reviewReason,
    'GeminiWriter requires HITL approval before the workflow can proceed to posting steps.',
  );

  onStateUpdate({
    phase: 'running',
    hitlAction: undefined,
    hitlReason: undefined,
    hitlInstructions: undefined,
  });

  telemetry.emit({
    source: 'workflow',
    name: 'workflow.content.bootstrap.approved',
    sessionId: telemetryContext.sessionId,
    workflowId: telemetryContext.workflowId,
    details: {
      platform,
      approvedByHitl: true,
    },
  });
}

function classifySocialOutcome(
  workflowId: string,
  result: WorkflowResult,
): SocialPublishOutcome | undefined {
  if (!SOCIAL_WORKFLOW_IDS.has(workflowId)) return undefined;
  if (result.success) return 'published';

  const failedIndex = result.stepResults.findIndex(step => !step.success);
  const relevantText: string[] = [result.error ?? ''];

  if (failedIndex >= 0) {
    const failedStep = result.stepResults[failedIndex];
    relevantText.push(failedStep.output ?? '', failedStep.error ?? '');

    if (failedStep.stepId.startsWith('confirm_') && failedIndex > 0) {
      const previousStep = result.stepResults[failedIndex - 1];
      relevantText.push(previousStep.output ?? '', previousStep.error ?? '');
    }
  }

  const combined = relevantText.join(' ').toLowerCase();

  if (
    combined.includes('duplicate_risk:') ||
    combined.includes('preflight check failed') ||
    combined.includes('already said that') ||
    combined.includes('duplicate content') ||
    combined.includes('already been submitted') ||
    combined.includes('you already submitted this')
  ) return 'duplicate_rejected';

  if (combined.includes('rate limit') || combined.includes('too many requests')) return 'rate_limited';

  if (
    (combined.includes('auth') || combined.includes('login') || combined.includes('sign in')) &&
    (combined.includes('lost') || combined.includes('expired') || combined.includes('required'))
  ) return 'auth_lost';

  if (combined.includes('composer') || (combined.includes('draft') && combined.includes('lost'))) {
    return 'composer_lost_draft';
  }

  return 'unknown_publish_failure';
}

// ---------------------------------------------------------------------------
// Post-step memory recorder
// ---------------------------------------------------------------------------

/**
 * After an agent_task step, parse its output for a MEMORY_UPDATE block and
 * record the result in short-term memory.  Falls back gracefully if the
 * agent did not emit the block.
 */
async function recordAgentStepMemory(
  stepId: string,
  output: string | undefined,
  screenshotPaths: string[],
  sensitiveFieldLabels: Set<string> = new Set(),
): Promise<void> {
  const raw = output ?? '';
  const currentUrl = await sessionManager.currentUrl().catch(() => '');

  const parsed = parseMemoryUpdate(raw, stepId, screenshotPaths);
  if (parsed) {
    // Deterministically redact sensitive fields by exact label match against the
    // workflow step's declared targets (no regex over prompts/selectors).
    if (sensitiveFieldLabels.size > 0) {
      for (const f of parsed.completedFields) {
        if (sensitiveFieldLabels.has(f.label)) {
          f.value = '[REDACTED]';
        }
      }
    }
    // Patch in the live URL if the agent didn't report one
    if (!parsed.currentUrl) parsed.currentUrl = currentUrl;
    shortTermMemory.recordStep(parsed);
  } else {
    shortTermMemory.recordStep(
      buildFallbackMemory(stepId, raw, currentUrl, screenshotPaths),
    );
  }
}

async function isAuthVerificationSatisfied(
  step: Extract<WorkflowStep, { type: 'human_takeover' }>,
): Promise<boolean> {
  if (!step.authVerification) return false;

  const page = await sessionManager.getPage();
  const checks = step.authVerification;
  const matchesSignals = async (): Promise<boolean> => {
    const currentUrl = await sessionManager.currentUrl().catch(() => '');

    if ((checks.urlIncludes?.length ?? 0) > 0) {
      const matchedUrl = checks.urlIncludes!.some(fragment => currentUrl.includes(fragment));
      if (matchedUrl) return true;
    }

    if ((checks.visibleSelectors?.length ?? 0) > 0) {
      for (const selector of checks.visibleSelectors ?? []) {
        try {
          const locator = page.locator(selector).first();
          if (await locator.isVisible({ timeout: 500 })) return true;
        } catch {
          // ignore selector failures and continue checking other signals
        }
      }
    }

    if ((checks.textIncludes?.length ?? 0) > 0) {
      try {
        const pageText: string = await page.evaluate(() =>
          (document.body as HTMLElement).innerText.replace(/\s{3,}/g, '\n').trim(),
        );
        const matchedText = checks.textIncludes!.some(text => pageText.includes(text));
        if (matchedText) return true;
      } catch {
        // ignore text extraction failures
      }
    }
    return false;
  };

  if (await matchesSignals()) return true;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.waitForTimeout(750);
    if (await matchesSignals()) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Story builder
// ---------------------------------------------------------------------------

function buildStory(
  definition: WorkflowDefinition,
  sessionId: string,
  startedAt: number,
  result: WorkflowResult,
): Story {
  const session = shortTermMemory.getSession();
  const totalAgentSteps = shortTermMemory.getTotalAgentSteps();

  const outcome: Story['outcome'] = result.success
    ? 'success'
    : result.stepResults.some(s => s.success)
    ? 'partial'
    : 'failure';

  // Build a narrative summary
  const completedFields = shortTermMemory.getAllCompletedFields();
  const fieldCount = completedFields.length;
  const stepCount = result.stepResults.filter(s => s.success).length;
  const durSec = (result.durationMs / 1000).toFixed(1);

  const summary =
    `Workflow "${definition.name}" ran for ${durSec}s completing ` +
    `${stepCount}/${definition.steps.length} steps. ` +
    (fieldCount > 0
      ? `${fieldCount} form fields were confirmed filled.`
      : 'No structured field confirmations were recorded.') +
    (result.error ? ` Run ended with error: ${result.error}` : '');

  // Lessons learned from carry-forward notes
  const notes = shortTermMemory.getAllNotes();
  const lessonsLearned = notes.length > 0
    ? notes
    : result.success
    ? ['Workflow completed without notable issues.']
    : [`Workflow failed at step: ${result.stepResults.slice(-1)[0]?.stepId ?? 'unknown'}`];

  // Pull improvements we know about from this workflow
  const improvements = longTermMemory
    .getAllImprovements()
    .filter(i => i.workflowIds.includes(definition.id))
    .map(i => ({
      improvementId: i.id,
      category: i.category,
      title: i.title,
      description: i.description,
    }));

  return {
    id: `${definition.id}-${sessionId}`,
    workflowId: definition.id,
    workflowName: definition.name,
    sessionId,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    outcome,
    summary,
    lessonsLearned,
    improvements,
    metrics: {
      totalWorkflowSteps: definition.steps.length,
      totalAgentSteps: totalAgentSteps || result.stepResults.length,
      durationMs: result.durationMs,
    },
  };
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
  telemetryContext: { sessionId: string; workflowId: string },
): Promise<StepResult> {
  const start = Date.now();
  const sub = substituteStep(step, params);
  telemetry.emit({
    source: 'workflow',
    name: 'workflow.step.started',
    sessionId: telemetryContext.sessionId,
    workflowId: telemetryContext.workflowId,
    stepId: sub.id,
    details: { type: sub.type },
  });

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
        const field = (sub as {
          field?: {
            id?: string;
            kind?: string;
            label?: string;
            sensitivity?: string;
            source?: string;
          };
        }).field;
        const isSpi =
          field?.kind === 'dob' ||
          field?.kind === 'ssn' ||
          field?.sensitivity === 'spi';

        // Deterministic PII gating: for high-sensitivity PII, pause and require
        // secure HITL input before typing into the browser.
        if (isSpi) {
          const label = field?.label ?? 'Sensitive field';
          const fieldId = field?.id ?? sub.id;
          telemetry.emit({
            source: 'workflow',
            name: 'workflow.step.pii_wait',
            sessionId: telemetryContext.sessionId,
            workflowId: telemetryContext.workflowId,
            stepId: sub.id,
            details: {
              fieldId,
              label,
              sensitivity: field?.sensitivity ?? 'spi',
            },
          });
          let value = shortTermMemory.getPreFlightValue(fieldId);

          if (!value) {
            onStateUpdate({
              phase: 'pii_wait',
              hitlAction: 'secure_input',
              hitlReason: `PII entry required: ${label}`,
              hitlInstructions:
                'Enter the value in the secure input below. It will be typed into the browser ' +
                'without being injected into model prompts or long-term artifacts.',
              hitlFieldId: fieldId,
              hitlFieldLabel: label,
              hitlFieldSensitivity: field?.sensitivity ?? 'spi',
            });
            value = await hitlCoordinator.requestSensitiveValue(
              label,
              'Secure HITL input required for sensitive data.',
            );
            onStateUpdate({
              phase: 'running',
              hitlAction: undefined,
              hitlReason: undefined,
              hitlInstructions: undefined,
              hitlFieldId: undefined,
              hitlFieldLabel: undefined,
              hitlFieldSensitivity: undefined,
            });
            if (!value) {
              return {
                stepId: sub.id,
                success: false,
                error: `Missing secure HITL input for ${label}`,
                durationMs: Date.now() - start,
              };
            }
            shortTermMemory.storePreFlightValue({
              fieldId,
              label,
              kind: field?.kind ?? 'sensitive',
              sensitivity: field?.sensitivity ?? 'spi',
              value,
            });
          }

          await sessionManager.type(sub.selector, value, sub.clearFirst);
          shortTermMemory.addScratchNote(`Secure HITL entry completed for ${label}.`);
          return { stepId: sub.id, success: true, durationMs: Date.now() - start };
        }

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
        return {
          stepId: sub.id,
          success: true,
          screenshotPath: filePath,
          screenshotBase64: b64,
          durationMs: Date.now() - start,
        };
      }

      // ----- extract --------------------------------------------------------
      case 'extract': {
        const page = await sessionManager.getPage();
        const pageText: string = await page.evaluate(() =>
          (document.body as HTMLElement).innerText.replace(/\s{3,}/g, '\n').trim(),
        );
        const result = `[Extract instruction: ${sub.instruction}]\n\n${pageText.slice(0, 4000)}`;
        outputs[sub.outputKey] = result;
        return {
          stepId: sub.id,
          success: true,
          output: result,
          durationMs: Date.now() - start,
        };
      }

      // ----- agent_task -----------------------------------------------------
      case 'agent_task': {
        const targets = (sub as {
          targets?: Array<{ label: string; kind?: string; sensitivity?: string }>;
        }).targets ?? [];
        const guardedFields = targets
          .filter(target =>
            target.kind === 'dob' ||
            target.kind === 'ssn' ||
            (target.sensitivity ?? 'none') === 'spi',
          )
          .map(target => target.label);

        if (guardedFields.length > 0) {
          onStateUpdate({
            phase: 'pii_wait',
            hitlAction: 'return_control',
            hitlReason: `HITL must complete sensitive fields: ${guardedFields.join(', ')}`,
            hitlInstructions:
              'Complete the sensitive fields manually in the browser. When done, click "Return Control to Claude".',
          });
          await hitlCoordinator.requestTakeover(
            `HITL must complete sensitive fields: ${guardedFields.join(', ')}`,
            'Sensitive fields are excluded from model prompts and must remain HITL-controlled.',
          );
          onStateUpdate({
            phase: 'running',
            hitlAction: undefined,
            hitlReason: undefined,
            hitlInstructions: undefined,
          });
          shortTermMemory.addScratchNote(
            `HITL manually completed sensitive fields before agent task: ${guardedFields.join(', ')}.`,
          );
        }

        const engineId = await routeAgentTask(sub.prompt, sub.engine);
        telemetry.emit({
          source: 'engine',
          name: 'workflow.agent_task.routed',
          sessionId: telemetryContext.sessionId,
          workflowId: telemetryContext.workflowId,
          stepId: sub.id,
          details: { engineId },
        });
        onStateUpdate({ currentStep: `${sub.id} → ${engineId}` });

        // Derive section label: prefer explicit memorySection, fallback to step id slug
        const memorySection =
          (sub as { memorySection?: string }).memorySection ??
          sub.id.replace(/[^a-z0-9]/gi, '-').toLowerCase();

        // Wrap prompt with SIC best-practices + session memory context
        const enhancedPrompt = buildEnhancedPrompt(sub.prompt, memorySection, guardedFields);

        let taskResult;
        if (engineId === 'stagehand') {
          const engine = await registry.getReady('stagehand');
          taskResult = await engine.runTask(enhancedPrompt);
        } else {
          const cookies = await sessionManager.extractCookies();
          const engine = await registry.getReady(engineId);
          taskResult = await engine.runTask(enhancedPrompt, { cookies });
        }

        // Record step in short-term memory for the next step's context
        const stepScreenshots = taskResult.screenshots?.map(s => s.path) ?? [];
        const sensitiveLabels = new Set(
          targets
            .filter(t => (t.sensitivity ?? 'none') !== 'none')
            .map(t => t.label),
        );
        await recordAgentStepMemory(sub.id, taskResult.output, stepScreenshots, sensitiveLabels);

        // Check outputFailsOn: if the agent output contains a blocked pattern, fail the step.
        const outputFailsOn = (sub as { outputFailsOn?: string[] }).outputFailsOn ?? [];
        if (taskResult.success && outputFailsOn.length > 0) {
          const output = taskResult.output ?? '';
          const matchedPattern = outputFailsOn.find(pattern => output.includes(pattern));
          if (matchedPattern) {
            const failReason = `Preflight check failed: agent output matched "${matchedPattern}". Output: ${output.slice(0, 300)}`;
            telemetry.emit({
              source: 'workflow',
              name: 'workflow.preflight.blocked',
              level: 'warn',
              sessionId: telemetryContext.sessionId,
              workflowId: telemetryContext.workflowId,
              stepId: sub.id,
              details: { matchedPattern, output: output.slice(0, 300) },
            });
            return {
              stepId: sub.id,
              success: false,
              output: taskResult.output,
              error: failReason,
              durationMs: Date.now() - start,
            };
          }
        }

        return {
          stepId: sub.id,
          success: taskResult.success,
          output: taskResult.output,
          error:
            taskResult.error ??
            (!taskResult.success && taskResult.output
              ? String(taskResult.output)
              : undefined),
          durationMs: Date.now() - start,
        };
      }

      // ----- human_takeover -------------------------------------------------
      case 'human_takeover': {
        const mode = sub.mode ?? 'takeover';
        const isVerificationGate = mode === 'takeover' && Boolean(sub.authVerification);
        if (mode === 'takeover' && await isAuthVerificationSatisfied(sub)) {
          const skipReason = `Skipped ${sub.id} because auth verification signals were already satisfied.`;
          shortTermMemory.addScratchNote(skipReason);
          telemetry.emit({
            source: 'workflow',
            name: 'workflow.hitl_takeover.auth_verification_satisfied',
            sessionId: telemetryContext.sessionId,
            workflowId: telemetryContext.workflowId,
            stepId: sub.id,
            details: {
              reason: skipReason,
            },
          });
          return { stepId: sub.id, success: true, durationMs: Date.now() - start };
        }
        const phase = mode === 'confirm_completion' ? 'hitl_qa' : 'awaiting_human';
        const hitlReason = isVerificationGate
          ? `Verify authenticated state: ${sub.reason}`
          : sub.reason;
        const hitlInstructions = isVerificationGate
          ? 'Verify whether the portal is already authenticated. If you are already signed in, do not log in again; simply continue. If authentication is still required, complete the login and then continue.'
          : sub.instructions;
        onStateUpdate({
          phase,
          hitlAction:
            mode === 'confirm_completion'
              ? 'confirm_completion'
              : isVerificationGate
              ? 'verify_authentication'
              : 'return_control',
          hitlReason,
          hitlInstructions,
        });
        if (mode === 'confirm_completion') {
          const confirmation = await hitlCoordinator.requestCompletionConfirmation(
            hitlReason,
            hitlInstructions,
          );
          onStateUpdate({
            phase: 'running',
            hitlAction: undefined,
            hitlReason: undefined,
            hitlInstructions: undefined,
          });
          if (!confirmation.confirmed) {
            const failureReason =
              confirmation.reason?.trim() ||
              `HITL did not confirm completion for step: ${sub.id}`;
            shortTermMemory.addScratchNote(
              `Final-step rejection for ${sub.id}: ${failureReason}`,
            );
            telemetry.emit({
              source: 'workflow',
              name: 'workflow.hitl_confirmation.rejected',
              level: 'error',
              sessionId: telemetryContext.sessionId,
              workflowId: telemetryContext.workflowId,
              stepId: sub.id,
              details: {
                reason: failureReason,
              },
            });
            recordFinalConfirmationSelfHeal(
              telemetryContext.workflowId,
              sub.id,
              failureReason,
            );
            onStateUpdate({
              phase: 'error',
              error: failureReason,
              hitlComments: failureReason,
              hitlFailureReason: failureReason,
              hitlFailureStepId: sub.id,
              hitlOutcomeConfirmed: false,
            });
            return {
              stepId: sub.id,
              success: false,
              error: failureReason,
              durationMs: Date.now() - start,
            };
          }
          onStateUpdate({
            hitlOutcomeConfirmed: true,
            hitlFailureReason: undefined,
            hitlFailureStepId: undefined,
          });
        } else {
          await hitlCoordinator.requestTakeover(hitlReason, hitlInstructions);
          onStateUpdate({
            phase: 'running',
            hitlAction: undefined,
            hitlReason: undefined,
            hitlInstructions: undefined,
          });
        }
        return { stepId: sub.id, success: true, durationMs: Date.now() - start };
      }

      // ----- generate_content -----------------------------------------------
      case 'generate_content': {
        const preflightBody = outputs[sub.outputKey];
        const preflightTitle = sub.outputTitleKey ? outputs[sub.outputTitleKey] : undefined;
        if (preflightBody && (!sub.outputTitleKey || preflightTitle)) {
          telemetry.emit({
            source: 'workflow',
            name: 'workflow.generate_content.skipped_preflight',
            sessionId: telemetryContext.sessionId,
            workflowId: telemetryContext.workflowId,
            stepId: sub.id,
            details: {
              outputKey: sub.outputKey,
              outputTitleKey: sub.outputTitleKey ?? '',
            },
          });
          return {
            stepId: sub.id,
            success: true,
            output: preflightTitle
              ? `TITLE: ${preflightTitle}\nBODY: ${preflightBody}`
              : preflightBody,
            durationMs: Date.now() - start,
          };
        }

        const writer = getGeminiWriter();
        const generated = await writer.writePost({
          platform: sub.platform,
          topic: substitute(sub.topic, params),
          context: sub.context ? substitute(sub.context, params) : undefined,
          tone: sub.tone,
          includeTitle: Boolean(sub.outputTitleKey),
        });
        outputs[sub.outputKey] = generated.text;
        if (sub.outputTitleKey && generated.title) {
          outputs[sub.outputTitleKey] = generated.title;
        }
        telemetry.emit({
          source: 'workflow',
          name: 'workflow.generate_content.completed',
          sessionId: telemetryContext.sessionId,
          workflowId: telemetryContext.workflowId,
          stepId: sub.id,
          details: {
            platform: sub.platform,
            model: generated.model,
            hasTitle: Boolean(generated.title),
            bodyLength: generated.text.length,
          },
        });
        return {
          stepId: sub.id,
          success: true,
          output: generated.title
            ? `TITLE: ${generated.title}\nBODY: ${generated.text}`
            : generated.text,
          durationMs: Date.now() - start,
        };
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
    telemetry.emit({
      source: 'workflow',
      name: 'workflow.step.failed',
      level: 'error',
      sessionId: telemetryContext.sessionId,
      workflowId: telemetryContext.workflowId,
      stepId: step.id,
      durationMs: Date.now() - start,
      details: {
        type: (step as { type?: string }).type ?? 'unknown',
        error: e instanceof Error ? e.message : String(e),
      },
    });
    return {
      stepId: step.id,
      success: false,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  } finally {
    telemetry.emit({
      source: 'workflow',
      name: 'workflow.step.finished',
      sessionId: telemetryContext.sessionId,
      workflowId: telemetryContext.workflowId,
      stepId: sub.id,
      durationMs: Date.now() - start,
      details: { type: sub.type },
    });
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

    // Resolve params / apply defaults
    const resolvedParams: Record<string, unknown> = { ...params };
    for (const [key, def] of Object.entries(definition.params ?? {})) {
      if (resolvedParams[key] === undefined) {
        if (def.default !== undefined) {
          resolvedParams[key] = def.default;
        } else if (def.required !== false && !(isSocialWorkflow(definition.id) && isEditorialMessageParam(key))) {
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

    const resolvedDefinition: WorkflowDefinition = {
      ...definition,
      steps: definition.steps.map(step => substituteStep(step, resolvedParams)),
    };

    // ---- Begin short-term memory for this run ----
    shortTermMemory.begin(id, definition.id);
    telemetry.emit({
      source: 'workflow',
      name: 'workflow.run.started',
      sessionId: id,
      workflowId: definition.id,
      details: {
        workflowName: definition.name,
        stepCount: definition.steps.length,
      },
    });

    // ---- Seed known improvements into long-term memory ----
    seedKnownImprovements(definition.id);

    // Ensure browser session is running
    await sessionManager.start();
    hitlCoordinator.setPhase('running');

    const onStateUpdate = (partial: Partial<SessionState>): void => {
      const previousPhase = this._currentState?.phase;
      this._currentState = {
        id,
        phase: 'running',
        startedAt: new Date(workflowStart),
        lastUpdatedAt: new Date(),
        ...this._currentState,
        ...partial,
      };
      hitlCoordinator.emit('phase_changed', this._currentState);
      if (partial.phase && partial.phase !== previousPhase) {
        telemetry.emit({
          source: 'workflow',
          name: 'workflow.phase.changed',
          sessionId: id,
          workflowId: definition.id,
          details: {
            phase: partial.phase,
            currentStep: this._currentState.currentStep ?? '',
          },
        });
      }
    };

    onStateUpdate({
      id,
      phase: 'pre_flight',
      totalSteps: definition.steps.length,
      completedSteps: 0,
      startedAt: new Date(workflowStart),
      lastUpdatedAt: new Date(),
    });

    const correlationMatches = memoryIndexer.findCorrelations(resolvedDefinition);
    const correlationSummary = memoryIndexer.summarize(correlationMatches);
    const isBespoke = memoryIndexer.isBespoke(resolvedDefinition);
    telemetry.emit({
      source: 'workflow',
      name: 'workflow.preflight.completed',
      sessionId: id,
      workflowId: definition.id,
      details: {
        correlationSummary,
        isBespoke,
        matchCount: correlationMatches.length,
      },
    });
    shortTermMemory.setCorrelations(correlationMatches, isBespoke);
    shortTermMemory.setScratchPlan(
      isBespoke
        ? 'No strong historical correlation. Slow down, inspect the portal, and verify each transition before execution.'
        : `Use the strongest prior correlation as baseline: ${correlationSummary}`,
    );
    shortTermMemory.addScratchNote(`Correlation summary: ${correlationSummary}`);

    onStateUpdate({
      phase: 'pre_flight',
      correlationSummary,
      isBespoke,
    });

    try {
      await bootstrapEditorialDraft(
        resolvedDefinition,
        resolvedParams,
        outputs,
        onStateUpdate,
        { sessionId: id, workflowId: definition.id },
      );
    } catch (e) {
      const errorText = e instanceof Error ? e.message : String(e);
      telemetry.emit({
        source: 'workflow',
        name: 'workflow.content.bootstrap.failed',
        level: 'error',
        sessionId: id,
        workflowId: definition.id,
        details: {
          error: errorText,
        },
      });
      return {
        workflowId: definition.id,
        success: false,
        stepResults,
        outputs,
        screenshots,
        durationMs: Date.now() - workflowStart,
        error: errorText,
      };
    }

    if (isBespoke) {
      shortTermMemory.addInvestigationNote(
        'Bespoke task detected. Inspect portal layers, shapes, and validation behavior before trusting automation.',
      );
      onStateUpdate({ phase: 'investigation' });
    }

    onStateUpdate({ phase: 'running' });

    let finalResult: WorkflowResult;

    try {
      for (let i = 0; i < definition.steps.length; i++) {
        const stepTemplate = definition.steps[i];
        // Re-resolve each step against live outputs so same-run placeholders
        // (for example {{x_post_text}}) are available to downstream steps.
        const runtimeParams = buildRuntimeParams(resolvedParams, outputs);
        const step = substituteStep(stepTemplate, runtimeParams);
        onStateUpdate({
          currentStep: step.id,
          stepIndex: i + 1,
          completedSteps: i,
          currentUrl: await sessionManager.currentUrl().catch(() => undefined),
        });

        const result = await executeStep(
          step,
          runtimeParams,
          screenshots,
          outputs,
          onStateUpdate,
          { sessionId: id, workflowId: definition.id },
        );
        stepResults.push(result);

        if (!result.success) {
          hitlCoordinator.setPhase('error');
          onStateUpdate({ phase: 'error', error: result.error });
          finalResult = {
            workflowId: definition.id,
            success: false,
            stepResults,
            outputs,
            screenshots,
            durationMs: Date.now() - workflowStart,
            error: `Step '${step.id}' failed: ${result.error}`,
          };
          break;
        }
      }

      if (!finalResult!) {
        hitlCoordinator.setPhase('complete');
        onStateUpdate({ phase: 'complete', completedSteps: definition.steps.length });
        finalResult = {
          workflowId: definition.id,
          success: true,
          stepResults,
          outputs,
          screenshots,
          durationMs: Date.now() - workflowStart,
        };
      }
    } catch (e) {
      finalResult = {
        workflowId: definition.id,
        success: false,
        stepResults,
        outputs,
        screenshots,
        durationMs: Date.now() - workflowStart,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    if (process.env.AI_VISION_UI_PORT) {
      const terminalPhase = finalResult.success ? 'complete' : 'error';
      const qaReason = 'Optional HITL QA pause before wrap-up';
      onStateUpdate({
        phase: 'hitl_qa',
        hitlAction: 'capture_notes',
        hitlReason: qaReason,
        hitlInstructions:
          'Use the HITL QA section to record notes, lessons learned, or recurring-portal context. ' +
          'When finished, click "Continue Wrap-up".',
        error: finalResult.error,
      });
      await hitlCoordinator.requestQaPause(
        qaReason,
        'Capture any final notes in the HITL QA section before the workflow wraps up.',
      );
      onStateUpdate({
        phase: terminalPhase,
        hitlAction: undefined,
        hitlReason: undefined,
        hitlInstructions: undefined,
        error: finalResult.error,
      });
    }

    // ---- Write long-term story ----
    try {
      await wrapUpWorkflowRun({
        definition: resolvedDefinition,
        sessionId: id,
        startedAt: workflowStart,
        result: finalResult,
        finalState: this._currentState,
      });
      telemetry.emit({
        source: 'wrapup',
        name: 'workflow.wrapup.completed',
        sessionId: id,
        workflowId: definition.id,
        details: {
          success: finalResult.success,
          durationMs: finalResult.durationMs,
        },
      });
    } catch (e) {
      // Non-fatal — don't let ETL/wrap-up break the workflow result
      console.error('[workflow] Failed to wrap up session:', e);
      telemetry.emit({
        source: 'wrapup',
        name: 'workflow.wrapup.failed',
        level: 'error',
        sessionId: id,
        workflowId: definition.id,
        details: {
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }

    // Classify social publish outcomes (post_to_x and future social workflows)
    const socialOutcome = classifySocialOutcome(definition.id, finalResult);
    if (socialOutcome) {
      finalResult.socialPublishOutcome = socialOutcome;
      onStateUpdate({ socialPublishOutcome: socialOutcome });
      telemetry.emit({
        source: 'workflow',
        name: 'workflow.social.outcome',
        level: socialOutcome === 'published' ? 'info' : 'warn',
        sessionId: id,
        workflowId: definition.id,
        details: { socialPublishOutcome: socialOutcome },
      });
    }

    telemetry.emit({
      source: 'workflow',
      name: finalResult.success ? 'workflow.run.completed' : 'workflow.run.failed',
      level: finalResult.success ? 'info' : 'error',
      sessionId: id,
      workflowId: definition.id,
      durationMs: finalResult.durationMs,
      details: {
        success: finalResult.success,
        error: finalResult.error ?? '',
        ...(socialOutcome ? { socialPublishOutcome: socialOutcome } : {}),
      },
    });

    return finalResult;
  }
}

export const workflowEngine = new WorkflowEngine();
