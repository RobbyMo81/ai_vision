import { runOrchestratorLoop } from './loop';
import { WorkflowDefinition } from '../workflow/types';
import { browserUseActionEvents } from '../engines/python-bridge';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAnthropicCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: mockAnthropicCreate,
      },
    })),
  };
});

const mockLoadAllInstructions = jest.fn(() => ({} as Record<string, string>));
const mockFormatBankContext = jest.fn(() => '');
jest.mock('./loader', () => ({
  loadAllInstructions: () => mockLoadAllInstructions(),
}));
jest.mock('../memory', () => ({
  formatBankContext: () => mockFormatBankContext(),
  shortTermMemory: { begin: jest.fn(), getContextPrompt: jest.fn(() => '') },
  longTermMemory: { getSicPromptBlock: jest.fn(() => '') },
  memoryIndexer: { findCorrelations: jest.fn(() => []), summarize: jest.fn(() => ''), isBespoke: jest.fn(() => false) },
  parseMemoryUpdate: jest.fn(() => null),
  buildFallbackMemory: jest.fn(),
  ShortTermMemoryManager: { getOutputFormatInstruction: jest.fn(() => '') },
}));

const mockRequestQaPause = jest.fn().mockResolvedValue(undefined);
const mockRequestTakeover = jest.fn().mockResolvedValue(undefined);
jest.mock('../session/hitl', () => ({
  hitlCoordinator: {
    setPhase: jest.fn(),
    emit: jest.fn(),
    requestQaPause: (...args: unknown[]) => mockRequestQaPause(...args),
    requestTakeover: (...args: unknown[]) => mockRequestTakeover(...args),
  },
}));

jest.mock('../session/manager', () => ({
  sessionManager: {
    start: jest.fn(),
    close: jest.fn(),
    getPage: jest.fn(),
    currentUrl: jest.fn(() => 'https://example.test/'),
  },
}));

jest.mock('../telemetry', () => ({
  telemetry: { emit: jest.fn() },
}));

const mockRunTask = jest.fn();
jest.mock('../engines/registry', () => ({
  registry: {
    getReady: jest.fn(async () => ({ runTask: mockRunTask })),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEndTurnResponse() {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Workflow complete.' }],
  };
}

function makeToolUseResponse(tools: Array<{ id: string; name: string; input: Record<string, unknown> }>) {
  return {
    stop_reason: 'tool_use',
    content: tools.map(t => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input })),
  };
}

const BASE_DEFINITION: WorkflowDefinition = {
  id: 'loop-unit-test',
  name: 'Loop Unit Test',
  mode: 'direct',
  source: 'yaml',
  params: {},
  steps: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runOrchestratorLoop US-009', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadAllInstructions.mockReturnValue({});
    mockFormatBankContext.mockReturnValue('');
    mockRunTask.mockReset();
  });

  it('reads instructions before first tool call', async () => {
    mockAnthropicCreate.mockResolvedValue(makeEndTurnResponse());

    await runOrchestratorLoop(BASE_DEFINITION, {}, 'sess-001');

    expect(mockLoadAllInstructions).toHaveBeenCalledTimes(1);
  });

  it('reads memory bank context before first tool call', async () => {
    mockAnthropicCreate.mockResolvedValue(makeEndTurnResponse());

    await runOrchestratorLoop(BASE_DEFINITION, {}, 'sess-001');

    expect(mockFormatBankContext).toHaveBeenCalledTimes(1);
  });

  it('includes instructions in system prompt when present', async () => {
    mockLoadAllInstructions.mockReturnValue({ orchestrator: '# Be precise and systematic.' });
    mockAnthropicCreate.mockResolvedValue(makeEndTurnResponse());

    await runOrchestratorLoop(BASE_DEFINITION);

    const callArgs = mockAnthropicCreate.mock.calls[0][0];
    expect(callArgs.system).toContain('Instructions: orchestrator');
    expect(callArgs.system).toContain('Be precise and systematic.');
  });

  it('includes bank context in system prompt when present', async () => {
    mockFormatBankContext.mockReturnValue('# Memory Bank\n\n## world.md\n\nSome world context.');
    mockAnthropicCreate.mockResolvedValue(makeEndTurnResponse());

    await runOrchestratorLoop(BASE_DEFINITION);

    const callArgs = mockAnthropicCreate.mock.calls[0][0];
    expect(callArgs.system).toContain('Memory Bank');
    expect(callArgs.system).toContain('world.md');
  });

  it('returns success on end_turn', async () => {
    mockAnthropicCreate.mockResolvedValue(makeEndTurnResponse());

    const result = await runOrchestratorLoop(BASE_DEFINITION, {}, 'sess-end-turn');

    expect(result.success).toBe(true);
    expect(result.workflowId).toBe('loop-unit-test');
  });

  it('returns success when complete_workflow tool is called', async () => {
    mockAnthropicCreate
      .mockResolvedValueOnce(
        makeToolUseResponse([
          { id: 'tu-1', name: 'complete_workflow', input: { summary: 'All done', outputs: { foo: 'bar' } } },
        ]),
      )
      .mockResolvedValue(makeEndTurnResponse());

    const result = await runOrchestratorLoop(BASE_DEFINITION);

    expect(result.success).toBe(true);
    expect(result.outputs.foo).toBe('bar');
  });

  it('stores orchestrator screenshot outputs as screenshot payload containers', async () => {
    const mockPage = {
      screenshot: jest.fn().mockResolvedValue(Buffer.from('png-bytes')),
      url: jest.fn(() => 'https://example.com/visible'),
    };
    const { sessionManager } = require('../session/manager');
    sessionManager.getPage.mockResolvedValue(mockPage);

    mockAnthropicCreate
      .mockResolvedValueOnce(
        makeToolUseResponse([
          { id: 'tu-1', name: 'screenshot', input: { step_id: 'capture_visible', output_key: 'visible_screenshot' } },
        ]),
      )
      .mockResolvedValue(makeEndTurnResponse());

    const result = await runOrchestratorLoop(BASE_DEFINITION, {}, 'sess-shot');
    const payload = JSON.parse(result.outputs.visible_screenshot);

    expect(payload).toEqual(expect.objectContaining({
      source: 'orchestrator',
      class: 'live_frame',
      mimeType: 'image/png',
      base64: Buffer.from('png-bytes').toString('base64'),
      sessionId: 'sess-shot',
      workflowId: 'loop-unit-test',
      stepId: 'capture_visible',
      url: 'https://example.com/visible',
      sensitivity: 'unknown',
      retention: 'ephemeral',
      persistBase64: false,
    }));
  });

  it('enforces permissions.require_human_approval_before on matching step_id', async () => {
    const definition: WorkflowDefinition = {
      ...BASE_DEFINITION,
      permissions: { require_human_approval_before: ['submit_step'] },
    };

    mockAnthropicCreate
      .mockResolvedValueOnce(
        makeToolUseResponse([
          { id: 'tu-1', name: 'navigate', input: { step_id: 'submit_step', url: 'https://example.com' } },
        ]),
      )
      .mockResolvedValue(makeEndTurnResponse());

    // sessionManager.getPage must resolve for navigate to succeed
    const mockPage = { goto: jest.fn().mockResolvedValue(undefined) };
    const { sessionManager } = require('../session/manager');
    sessionManager.getPage.mockResolvedValue(mockPage);

    await runOrchestratorLoop(definition);

    expect(mockRequestQaPause).toHaveBeenCalledTimes(1);
    expect(mockRequestQaPause.mock.calls[0][0]).toContain('submit_step');
  });

  it('does not request approval for steps not in require_human_approval_before', async () => {
    const definition: WorkflowDefinition = {
      ...BASE_DEFINITION,
      permissions: { require_human_approval_before: ['other_step'] },
    };

    const mockPage = { goto: jest.fn().mockResolvedValue(undefined) };
    const { sessionManager } = require('../session/manager');
    sessionManager.getPage.mockResolvedValue(mockPage);

    mockAnthropicCreate
      .mockResolvedValueOnce(
        makeToolUseResponse([
          { id: 'tu-1', name: 'navigate', input: { step_id: 'safe_step', url: 'https://example.com' } },
        ]),
      )
      .mockResolvedValue(makeEndTurnResponse());

    await runOrchestratorLoop(definition);

    expect(mockRequestQaPause).not.toHaveBeenCalled();
  });

  it('returns failure after exceeding max iterations', async () => {
    // Always return tool_use (no complete_workflow), forcing the loop to hit the limit
    mockAnthropicCreate.mockResolvedValue(
      makeToolUseResponse([
        { id: 'tu-x', name: 'navigate', input: { step_id: 's', url: 'https://example.com' } },
      ]),
    );

    const mockPage = { goto: jest.fn().mockResolvedValue(undefined) };
    const { sessionManager } = require('../session/manager');
    sessionManager.getPage.mockResolvedValue(mockPage);

    const result = await runOrchestratorLoop(BASE_DEFINITION);

    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeded maximum iterations');
  }, 15000);

  it('returns failure when Anthropic throws', async () => {
    mockAnthropicCreate.mockRejectedValue(new Error('API rate limit'));

    const result = await runOrchestratorLoop(BASE_DEFINITION);

    expect(result.success).toBe(false);
    expect(result.error).toContain('API rate limit');
  });

  it('receives browser-use live events during agent_task without polling', async () => {
    mockRunTask.mockImplementation(async (_prompt: string, context?: { sessionId?: string; workflowId?: string; stepId?: string }) => {
      browserUseActionEvents.emit('browser_use_action', {
        engineId: 'browser-use',
        name: 'browser_use.action.click',
        sessionId: context?.sessionId,
        workflowId: context?.workflowId,
        stepId: context?.stepId,
        browserUseStepId: 'browser-use-step-1',
        browserUseStepNumber: 1,
        action: 'click',
        actionNames: ['click'],
        actions: [{ name: 'click', params: { index: 2 } }],
        url: 'https://example.com/dashboard',
        timestamp: new Date('2026-04-23T00:00:00.000Z').toISOString(),
      });
      return {
        success: true,
        output: 'posted',
        screenshots: [],
        durationMs: 5,
      };
    });

    mockAnthropicCreate
      .mockResolvedValueOnce(
        makeToolUseResponse([
          { id: 'tu-1', name: 'agent_task', input: { step_id: 'publish_post', prompt: 'Post the draft', engine: 'browser-use' } },
        ]),
      )
      .mockResolvedValue(makeEndTurnResponse());

    const onStateUpdate = jest.fn();
    const result = await runOrchestratorLoop(BASE_DEFINITION, {}, 'sess-live', onStateUpdate);

    expect(result.success).toBe(true);
    expect(mockRunTask).toHaveBeenCalledWith('Post the draft', expect.objectContaining({
      sessionId: 'sess-live',
      workflowId: 'loop-unit-test',
      stepId: 'publish_post',
    }));
    expect(onStateUpdate).toHaveBeenCalledWith(expect.objectContaining({
      currentUrl: 'https://example.com/dashboard',
      currentStep: 'browser-use: click',
    }));
  });
});
