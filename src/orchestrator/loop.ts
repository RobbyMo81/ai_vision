import Anthropic from '@anthropic-ai/sdk';
import { WorkflowDefinition, WorkflowResult, StepResult } from '../workflow/types';
import { SessionState } from '../session/types';
import { loadAllInstructions } from './loader';
import { formatBankContext } from '../memory';
import { sessionManager } from '../session/manager';
import { hitlCoordinator } from '../session/hitl';
import { telemetry } from '../telemetry';
import { registry } from '../engines/registry';

const MODEL = process.env.ORCHESTRATOR_MODEL ?? 'claude-sonnet-4-6';
const MAX_ITERATIONS = 50;

// ---------------------------------------------------------------------------
// Tool definitions exposed to the Claude orchestrator
// ---------------------------------------------------------------------------

const ORCHESTRATOR_TOOLS: Anthropic.Tool[] = [
  {
    name: 'navigate',
    description: 'Navigate the browser to a URL.',
    input_schema: {
      type: 'object' as const,
      properties: {
        step_id: { type: 'string', description: 'Unique step identifier' },
        url: { type: 'string', description: 'URL to navigate to' },
        wait_until: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'], description: 'Navigation wait condition' },
      },
      required: ['step_id', 'url'],
    },
  },
  {
    name: 'click',
    description: 'Click an element in the browser.',
    input_schema: {
      type: 'object' as const,
      properties: {
        step_id: { type: 'string' },
        selector: { type: 'string', description: 'CSS or text selector for the element' },
      },
      required: ['step_id', 'selector'],
    },
  },
  {
    name: 'type_text',
    description: 'Type text into a form field.',
    input_schema: {
      type: 'object' as const,
      properties: {
        step_id: { type: 'string' },
        selector: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['step_id', 'selector', 'text'],
    },
  },
  {
    name: 'screenshot',
    description: 'Capture a screenshot of the current browser state.',
    input_schema: {
      type: 'object' as const,
      properties: {
        step_id: { type: 'string' },
        output_key: { type: 'string', description: 'Key to store the screenshot reference under' },
      },
      required: ['step_id'],
    },
  },
  {
    name: 'extract',
    description: 'Extract information from the current page.',
    input_schema: {
      type: 'object' as const,
      properties: {
        step_id: { type: 'string' },
        instruction: { type: 'string', description: 'What to extract' },
        output_key: { type: 'string' },
      },
      required: ['step_id', 'instruction'],
    },
  },
  {
    name: 'agent_task',
    description: 'Delegate a complex browser task to an automation engine.',
    input_schema: {
      type: 'object' as const,
      properties: {
        step_id: { type: 'string' },
        prompt: { type: 'string', description: 'Detailed task instructions for the browser agent' },
        engine: { type: 'string', enum: ['auto', 'browser-use', 'skyvern'], description: 'Preferred engine' },
        output_key: { type: 'string' },
      },
      required: ['step_id', 'prompt'],
    },
  },
  {
    name: 'human_takeover',
    description: 'Pause and hand control to a human operator.',
    input_schema: {
      type: 'object' as const,
      properties: {
        step_id: { type: 'string' },
        reason: { type: 'string', description: 'Why human control is needed' },
        instructions: { type: 'string', description: 'Instructions for the human operator' },
      },
      required: ['step_id', 'reason'],
    },
  },
  {
    name: 'generate_content',
    description: 'Generate editorial content (post text, title) for a social platform.',
    input_schema: {
      type: 'object' as const,
      properties: {
        step_id: { type: 'string' },
        platform: { type: 'string', enum: ['x', 'reddit', 'linkedin'] },
        topic: { type: 'string' },
        context: { type: 'string' },
        tone: { type: 'string' },
        output_key: { type: 'string' },
        output_title_key: { type: 'string' },
      },
      required: ['step_id', 'platform', 'topic'],
    },
  },
  {
    name: 'complete_workflow',
    description: 'Signal that the workflow has finished successfully.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string', description: 'Brief description of what was accomplished' },
        outputs: {
          type: 'object',
          description: 'Key/value pairs of final workflow outputs',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['summary'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executor: map Claude tool calls to real browser/session actions
// ---------------------------------------------------------------------------

interface ToolInput {
  step_id?: string;
  [key: string]: unknown;
}

async function executeTool(
  name: string,
  input: ToolInput,
  outputs: Record<string, string>,
  onStateUpdate: (partial: Partial<SessionState>) => void,
): Promise<{ ok: boolean; result?: string; error?: string }> {
  try {
    switch (name) {
      case 'navigate': {
        const page = await sessionManager.getPage();
        await page.goto(input['url'] as string, {
          waitUntil: (input['wait_until'] as 'load' | 'domcontentloaded' | 'networkidle') ?? 'domcontentloaded',
        });
        return { ok: true, result: `Navigated to ${input['url']}` };
      }

      case 'click': {
        const page = await sessionManager.getPage();
        await page.click(input['selector'] as string);
        return { ok: true, result: `Clicked ${input['selector']}` };
      }

      case 'type_text': {
        const page = await sessionManager.getPage();
        await page.fill(input['selector'] as string, input['text'] as string);
        return { ok: true, result: `Typed into ${input['selector']}` };
      }

      case 'screenshot': {
        const page = await sessionManager.getPage();
        const buffer = await page.screenshot({ type: 'png' });
        const b64 = buffer.toString('base64');
        if (input['output_key']) outputs[input['output_key'] as string] = b64;
        return { ok: true, result: 'Screenshot captured' };
      }

      case 'extract': {
        const page = await sessionManager.getPage();
        const text = await page.evaluate(() => document.body.innerText);
        const result = `[Extract: ${input['instruction']}]\n${String(text).slice(0, 2000)}`;
        if (input['output_key']) outputs[input['output_key'] as string] = result;
        return { ok: true, result };
      }

      case 'agent_task': {
        const prompt = input['prompt'] as string;
        const engineId = (input['engine'] as string) ?? 'browser-use';
        const eng = await registry.getReady(engineId);
        const taskResult = await eng.runTask(prompt);
        await sessionManager.syncActivePage().catch(() => {});
        const result = taskResult.output ?? (taskResult.success ? 'Task completed' : taskResult.error ?? 'Task failed');
        if (input['output_key']) outputs[input['output_key'] as string] = result;
        if (!taskResult.success) return { ok: false, error: result };
        return { ok: true, result };
      }

      case 'human_takeover': {
        const reason = input['reason'] as string;
        const instructions = (input['instructions'] as string) ?? '';
        onStateUpdate({
          phase: 'awaiting_human',
          hitlAction: 'return_control',
          hitlReason: reason,
          hitlInstructions: instructions,
        });
        await hitlCoordinator.requestTakeover(reason, instructions);
        onStateUpdate({
          phase: 'running',
          hitlAction: undefined,
          hitlReason: undefined,
          hitlInstructions: undefined,
        });
        return { ok: true, result: 'Human takeover completed' };
      }

      case 'generate_content': {
        const placeholder = `[Generated ${input['platform']} content for: ${input['topic']}]`;
        if (input['output_key']) outputs[input['output_key'] as string] = placeholder;
        if (input['output_title_key']) outputs[input['output_title_key'] as string] = `[Title: ${input['topic']}]`;
        return { ok: true, result: placeholder };
      }

      case 'complete_workflow': {
        const extra = (input['outputs'] ?? {}) as Record<string, string>;
        Object.assign(outputs, extra);
        return { ok: true, result: input['summary'] as string };
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Build the initial user message from the workflow definition
// ---------------------------------------------------------------------------

function buildUserMessage(definition: WorkflowDefinition, params: Record<string, unknown>): string {
  const lines: string[] = [
    `Execute the following workflow: **${definition.name}**`,
    '',
    `Workflow ID: ${definition.id}`,
  ];

  if (definition.description) {
    lines.push(`Description: ${definition.description}`);
  }

  if (Object.keys(params).length > 0) {
    lines.push('', 'Parameters:');
    for (const [k, v] of Object.entries(params)) {
      lines.push(`  ${k}: ${JSON.stringify(v)}`);
    }
  }

  if (definition.steps.length > 0) {
    lines.push('', 'Steps to execute (in order):');
    definition.steps.forEach((step, i) => {
      lines.push(`  ${i + 1}. [${step.type}] id=${step.id}`);
    });
  }

  lines.push(
    '',
    'Work through the steps using the provided tools. When all steps are complete, call complete_workflow.',
    'If human approval is required for any step, use human_takeover first.',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main orchestrator loop
// ---------------------------------------------------------------------------

export async function runOrchestratorLoop(
  definition: WorkflowDefinition,
  params: Record<string, unknown> = {},
  sessionId?: string,
  onStateUpdate: (partial: Partial<SessionState>) => void = () => {},
): Promise<WorkflowResult> {
  const startMs = Date.now();
  const id = sessionId ?? `orch-${Date.now()}`;

  telemetry.emit({
    source: 'orchestrator',
    name: 'orchestrator.loop.started',
    sessionId: id,
    workflowId: definition.id,
    details: { workflowName: definition.name },
  });

  // 1. Read markdown instructions before first tool call
  const instructions = loadAllInstructions();

  // 2. Read memory bank context before first tool call
  const bankContext = formatBankContext();

  // 3. Build system prompt
  const systemParts: string[] = [
    'You are an AI orchestrator executing browser automation workflows. ' +
    'Use the provided tools to complete each workflow step in order. ' +
    'Call complete_workflow when done.',
  ];

  for (const [name, content] of Object.entries(instructions)) {
    systemParts.push(`# Instructions: ${name}\n\n${content}`);
  }

  if (bankContext) {
    systemParts.push(bankContext);
  }

  const system = systemParts.join('\n\n---\n\n');

  // 4. Collect step IDs that require human approval before execution
  const approvalRequired = new Set(definition.permissions?.require_human_approval_before ?? []);

  const stepResults: StepResult[] = [];
  const outputs: Record<string, string> = {};
  const screenshots: WorkflowResult['screenshots'] = [];

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildUserMessage(definition, params) },
  ];

  const client = new Anthropic();

  let iterations = 0;

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system,
        tools: ORCHESTRATOR_TOOLS,
        messages,
      });

      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        telemetry.emit({
          source: 'orchestrator',
          name: 'orchestrator.loop.completed',
          sessionId: id,
          workflowId: definition.id,
          details: { iterations },
        });
        return {
          workflowId: definition.id,
          success: true,
          stepResults,
          outputs,
          screenshots,
          durationMs: Date.now() - startMs,
        };
      }

      if (response.stop_reason !== 'tool_use') {
        break;
      }

      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        const toolInput = block.input as ToolInput;
        const stepId = toolInput['step_id'] ?? block.name;

        // 4. Enforce permissions.require_human_approval_before
        if (approvalRequired.has(stepId) || approvalRequired.has(block.name)) {
          await hitlCoordinator.requestQaPause(
            `Approval required before: ${block.name} (step: ${stepId})`,
            `Human approval required before the orchestrator executes tool "${block.name}" for step "${stepId}".`,
          );
        }

        const toolResult = await executeTool(block.name, toolInput, outputs, onStateUpdate);

        const stepResult: StepResult = {
          stepId: String(stepId),
          success: toolResult.ok,
          durationMs: 0,
          ...(toolResult.error ? { error: toolResult.error } : {}),
          ...(toolResult.result ? { output: toolResult.result } : {}),
        };
        stepResults.push(stepResult);

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(toolResult),
        });

        telemetry.emit({
          source: 'orchestrator',
          name: toolResult.ok ? 'orchestrator.tool.success' : 'orchestrator.tool.error',
          sessionId: id,
          workflowId: definition.id,
          details: { tool: block.name, stepId: String(stepId), error: toolResult.error ?? '' },
        });

        // complete_workflow signals loop termination
        if (block.name === 'complete_workflow') {
          messages.push({ role: 'user', content: toolResultBlocks });
          telemetry.emit({
            source: 'orchestrator',
            name: 'orchestrator.loop.completed',
            sessionId: id,
            workflowId: definition.id,
            details: { iterations },
          });
          return {
            workflowId: definition.id,
            success: true,
            stepResults,
            outputs,
            screenshots,
            durationMs: Date.now() - startMs,
          };
        }
      }

      messages.push({ role: 'user', content: toolResultBlocks });
    }

    return {
      workflowId: definition.id,
      success: false,
      stepResults,
      outputs,
      screenshots,
      durationMs: Date.now() - startMs,
      error: `Orchestrator loop exceeded maximum iterations (${MAX_ITERATIONS})`,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    telemetry.emit({
      source: 'orchestrator',
      name: 'orchestrator.loop.error',
      level: 'error',
      sessionId: id,
      workflowId: definition.id,
      details: { error },
    });
    return {
      workflowId: definition.id,
      success: false,
      stepResults,
      outputs,
      screenshots,
      durationMs: Date.now() - startMs,
      error,
    };
  }
}
