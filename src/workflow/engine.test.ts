const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const {
  buildRedditOverlapScores,
  collectUsableRedditTitles,
  normalizeRedditTitle,
  renderRedditDuplicateEvidence,
} = require('./reddit-duplicate');

let workflowEngine: import('./engine').WorkflowEngine;

const mockWriter = {
  writePost: jest.fn(),
};

const mockPage = {
  evaluate: jest.fn(),
};

const mockHitlCoordinator = {
  setPhase: jest.fn(),
  syncPhase: jest.fn(),
  emit: jest.fn(),
  requestQaPause: jest.fn(),
  requestTakeover: jest.fn().mockResolvedValue(undefined),
  requestSensitiveValue: jest.fn().mockResolvedValue('sensitive-value'),
  requestCompletionConfirmation: jest.fn().mockResolvedValue({ confirmed: true }),
};

const mockSessionManager = {
  start: jest.fn(),
  currentUrl: jest.fn(),
  getPage: jest.fn(),
  navigate: jest.fn(),
  syncSessionState: jest.fn(),
  handleStepAdvance: jest.fn(),
  setSensitiveScreenshotContext: jest.fn(),
  click: jest.fn(),
  type: jest.fn(),
  extractCookies: jest.fn(),
  syncActivePage: jest.fn(),
  startScreenshotTimer: jest.fn(),
  stopScreenshotTimer: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

const mockAutomationEngine = {
  id: 'browser-use',
  ready: true,
  initialize: jest.fn(),
  close: jest.fn(),
  runTask: jest.fn(),
  navigate: jest.fn(),
  click: jest.fn(),
  type: jest.fn(),
  screenshot: jest.fn(),
};

const mockRegistry = {
  get: jest.fn(() => ({ available: jest.fn().mockResolvedValue(true) })),
  getReady: jest.fn(async () => mockAutomationEngine),
};

const mockTelemetry = {
  emit: jest.fn(),
};

const mockSchedulePostTaskScreenshotCleanup = jest.fn();

const mockShortTermMemory = {
  begin: jest.fn(),
  getContextPrompt: jest.fn(() => ''),
  setCorrelations: jest.fn(),
  setScratchPlan: jest.fn(),
  addScratchNote: jest.fn(),
  addInvestigationNote: jest.fn(),
  getSession: jest.fn(() => null),
  getTotalAgentSteps: jest.fn(() => 0),
  getAllCompletedFields: jest.fn(() => []),
  getAllNotes: jest.fn(() => []),
  getPreFlightValue: jest.fn(() => undefined),
  storePreFlightValue: jest.fn(),
  recordStep: jest.fn(),
};

const mockLongTermMemory = {
  getSicPromptBlock: jest.fn(() => ''),
  recordImprovement: jest.fn(),
  getAllImprovements: jest.fn(() => []),
};

const mockMemoryIndexer = {
  findCorrelations: jest.fn(() => []),
  summarize: jest.fn(() => 'none'),
  isBespoke: jest.fn(() => false),
};

jest.mock('../session/manager', () => ({
  sessionManager: mockSessionManager,
}));

jest.mock('../session/hitl', () => ({
  hitlCoordinator: mockHitlCoordinator,
}));

jest.mock('../engines/registry', () => ({
  registry: mockRegistry,
}));

jest.mock('../content/gemini-writer', () => ({
  getGeminiWriter: () => mockWriter,
}));

jest.mock('../telemetry', () => ({
  telemetry: mockTelemetry,
}));

jest.mock('../session/screenshot-retention', () => {
  const actual = jest.requireActual('../session/screenshot-retention');
  return {
    ...actual,
    schedulePostTaskScreenshotCleanup: (...args: unknown[]) => mockSchedulePostTaskScreenshotCleanup(...args),
  };
});

jest.mock('./wrap-up', () => ({
  wrapUpWorkflowRun: jest.fn(async () => undefined),
}));

jest.mock('../memory', () => ({
  shortTermMemory: mockShortTermMemory,
  longTermMemory: mockLongTermMemory,
  memoryIndexer: mockMemoryIndexer,
  parseMemoryUpdate: jest.fn(() => null),
  buildFallbackMemory: jest.fn(() => ({
    section: 'fallback',
    completedFields: [],
    notes: [],
    currentUrl: '',
    screenshots: [],
  })),
  ShortTermMemoryManager: {
    getOutputFormatInstruction: jest.fn(() => ''),
  },
  formatBankContext: jest.fn(() => ''),
}));

const mockRunOrchestratorLoop = jest.fn();
jest.mock('../orchestrator/loop', () => ({
  runOrchestratorLoop: (...args: unknown[]) => mockRunOrchestratorLoop(...args),
}));

describe('workflowEngine RF-001 runtime output substitution', () => {
  beforeAll(() => {
    workflowEngine = require('./engine').workflowEngine;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSchedulePostTaskScreenshotCleanup.mockReset();
    mockWriter.writePost.mockReset();
    delete process.env.AI_VISION_UI_PORT;
    mockSessionManager.start.mockResolvedValue(undefined);
    mockSessionManager.currentUrl.mockResolvedValue('https://example.test/page');
    mockSessionManager.navigate.mockRejectedValue(new Error('unexpected fallback step executed'));
    mockSessionManager.getPage.mockResolvedValue(mockPage);
    mockSessionManager.click.mockResolvedValue(undefined);
    mockSessionManager.extractCookies.mockResolvedValue([]);
    mockSessionManager.syncActivePage.mockResolvedValue(undefined);
    mockSessionManager.close.mockResolvedValue(undefined);
    mockSessionManager.startScreenshotTimer.mockReturnValue(undefined);
    mockSessionManager.stopScreenshotTimer.mockReturnValue(undefined);
    mockPage.evaluate.mockResolvedValue('Rendered page body');
    mockWriter.writePost.mockResolvedValue({
      text: 'Generated post body',
      platform: 'x',
      model: 'gemini-test',
    });
    mockAutomationEngine.runTask.mockResolvedValue({
      success: true,
      output: 'ok',
      screenshots: [],
      durationMs: 5,
    });
  });

  it('resolves downstream placeholders from same-run outputs', async () => {
    mockWriter.writePost
      .mockResolvedValueOnce({
        text: 'Generated post body',
        platform: 'x',
        model: 'gemini-test',
      })
      .mockResolvedValueOnce({
        text: 'Followup post body',
        platform: 'x',
        model: 'gemini-test',
      });

    const definition = {
      id: 'rf001-test',
      name: 'RF-001 runtime substitution test',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'generate_content' as const,
          id: 'write_x_post',
          topic: 'Test topic',
          platform: 'x' as const,
          outputKey: 'x_post_text',
        },
        {
          type: 'generate_content' as const,
          id: 'write_followup_post',
          topic: 'Followup: {{x_post_text}}',
          platform: 'x' as const,
          outputKey: 'followup_post_text',
        },
      ],
    };

    const result = await workflowEngine.run(definition);

    expect(result.success).toBe(true);
    expect(result.outputs.x_post_text).toBe('Generated post body');
    expect(result.outputs.followup_post_text).toBe('Followup post body');
  });

  it('keeps the execution loop on the resolved step array when the original step source changes later', async () => {
    mockWriter.writePost
      .mockResolvedValueOnce({
        text: 'Generated post body',
        platform: 'x',
        model: 'gemini-test',
      })
      .mockResolvedValueOnce({
        text: 'Followup post body',
        platform: 'x',
        model: 'gemini-test',
      });

    const primarySteps = [
      {
        type: 'generate_content' as const,
        id: 'write_x_post',
        topic: 'Test topic',
        platform: 'x' as const,
        outputKey: 'x_post_text',
      },
      {
        type: 'generate_content' as const,
        id: 'write_followup_post',
        topic: 'Followup: {{x_post_text}}',
        platform: 'x' as const,
        outputKey: 'followup_post_text',
      },
    ];
    const fallbackSteps = [
      {
        type: 'navigate' as const,
        id: 'unexpected_fallback_step',
        url: 'https://should-not-run.invalid',
      },
    ];

    let stepsAccessCount = 0;
    const definition = {
      id: 'rf002-test',
      name: 'RF-002 unified step source test',
      mode: 'direct' as const,
      params: {},
      get steps() {
        stepsAccessCount += 1;
        return stepsAccessCount === 1 ? primarySteps : fallbackSteps;
      },
    } as unknown as {
      id: string;
      name: string;
      mode: 'direct';
      params: Record<string, never>;
      steps: typeof primarySteps;
    };

    const result = await workflowEngine.run(definition);

    expect(result.success).toBe(true);
    expect(result.outputs.x_post_text).toBe('Generated post body');
    expect(result.outputs.followup_post_text).toBe('Followup post body');
    expect(mockSessionManager.navigate).not.toHaveBeenCalled();
  });

  it('pre-flight hands off to GeminiWriter when social message is missing', async () => {
    process.env.AI_VISION_UI_PORT = '3010';
    mockWriter.writePost.mockResolvedValueOnce({
      text: 'Generated editorial body',
      platform: 'x',
      model: 'gemini-test',
    });

    const definition = {
      id: 'post_to_x',
      name: 'Pre-flight writer handoff test',
      mode: 'direct' as const,
      params: {
        post_text: { type: 'string' as const, required: true },
      },
      steps: [],
    };

    const result = await workflowEngine.run(definition, { topic: 'Alaska complaint update' });

    expect(result.success).toBe(true);
    expect(mockWriter.writePost).toHaveBeenCalled();
    expect(mockHitlCoordinator.requestQaPause).toHaveBeenCalled();
    expect(result.outputs.post_text).toBe('Generated editorial body');
    expect(result.outputs.x_post_text).toBe('Generated editorial body');
  });

  it('pre-flight skips GeminiWriter when user already provides social message', async () => {
    delete process.env.AI_VISION_UI_PORT;

    const definition = {
      id: 'post_to_x',
      name: 'Pre-flight writer skip test',
      mode: 'direct' as const,
      params: {
        post_text: { type: 'string' as const, required: true },
      },
      steps: [],
    };

    const result = await workflowEngine.run(definition, { post_text: 'User supplied post text' });

    expect(result.success).toBe(true);
    expect(mockWriter.writePost).not.toHaveBeenCalled();
    expect(mockHitlCoordinator.requestQaPause).not.toHaveBeenCalled();
  });

  it('schedules post-task screenshot cleanup only after a successful wrap-up', async () => {
    const definition = {
      id: 'us042-success-cleanup',
      name: 'US-042 success cleanup scheduling',
      mode: 'direct' as const,
      params: {},
      steps: [],
    };

    const result = await workflowEngine.run(definition, {}, 'sess-us042-success');

    expect(result.success).toBe(true);
    expect(mockSessionManager.stopScreenshotTimer).toHaveBeenCalled();
    expect(mockSchedulePostTaskScreenshotCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-us042-success',
        workflowId: 'us042-success-cleanup',
      }),
    );
    expect(mockSessionManager.stopScreenshotTimer.mock.invocationCallOrder[0]).toBeLessThan(
      mockSchedulePostTaskScreenshotCleanup.mock.invocationCallOrder[0],
    );
  });

  it('does not schedule post-task screenshot cleanup after a failed run', async () => {
    mockAutomationEngine.runTask.mockResolvedValueOnce({
      success: false,
      error: 'step failed',
      screenshots: [],
      durationMs: 5,
    });

    const definition = {
      id: 'us042-failed-cleanup',
      name: 'US-042 failed cleanup scheduling',
      mode: 'agentic' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'failing-step',
          prompt: 'fail',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {}, 'sess-us042-failed');

    expect(result.success).toBe(false);
    expect(mockSchedulePostTaskScreenshotCleanup).not.toHaveBeenCalled();
  });
});

describe('workflowEngine US-009 orchestrator loop delegation', () => {
  beforeAll(() => {
    workflowEngine = require('./engine').workflowEngine;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRunOrchestratorLoop.mockResolvedValue({
      workflowId: 'yaml-test',
      success: true,
      stepResults: [],
      outputs: { result: 'done' },
      screenshots: [],
      durationMs: 42,
    });
  });

  it('delegates to runOrchestratorLoop when definition.source is yaml', async () => {
    const definition = {
      id: 'yaml-test',
      name: 'YAML Test Workflow',
      source: 'yaml' as const,
      mode: 'agentic' as const,
      params: {},
      steps: [],
    };

    const result = await workflowEngine.run(definition, { topic: 'test' }, 'sess-001');

    expect(mockRunOrchestratorLoop).toHaveBeenCalledTimes(1);
    expect(mockRunOrchestratorLoop).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'yaml-test', source: 'yaml' }),
      expect.objectContaining({ topic: 'test' }),
      'sess-001',
      expect.any(Function),
    );
    expect(result.success).toBe(true);
    expect(result.outputs.result).toBe('done');
  });

  it('does not delegate to orchestrator loop for builtin workflows', async () => {
    const definition = {
      id: 'builtin-test',
      name: 'Builtin Test',
      source: 'builtin' as const,
      mode: 'direct' as const,
      params: {},
      steps: [],
    };

    mockSessionManager.start.mockResolvedValue(undefined);
    mockSessionManager.currentUrl.mockResolvedValue('https://example.test/');

    const result = await workflowEngine.run(definition);

    expect(mockRunOrchestratorLoop).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});

describe('workflowEngine US-023 HITL state publication', () => {
  beforeAll(() => {
    workflowEngine = require('./engine').workflowEngine;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AI_VISION_UI_PORT;
    mockSessionManager.start.mockResolvedValue(undefined);
    mockSessionManager.currentUrl.mockResolvedValue('https://example.test/page');
    mockSessionManager.getPage.mockResolvedValue(mockPage);
    mockSessionManager.close.mockResolvedValue(undefined);
    mockSessionManager.startScreenshotTimer.mockReturnValue(undefined);
    mockSessionManager.stopScreenshotTimer.mockReturnValue(undefined);
    mockSessionManager.type.mockResolvedValue(undefined);
    mockPage.evaluate.mockResolvedValue('Rendered page body');
    mockHitlCoordinator.requestTakeover.mockResolvedValue(undefined);
    mockHitlCoordinator.requestSensitiveValue.mockResolvedValue('4111');
    mockHitlCoordinator.requestCompletionConfirmation.mockResolvedValue({ confirmed: true });
    mockHitlCoordinator.requestQaPause.mockResolvedValue(undefined);
    mockWriter.writePost.mockResolvedValue({
      text: 'Generated post body',
      platform: 'x',
      model: 'gemini-test',
    });
  });

  it('publishes awaiting_human with return_control before a direct takeover wait', async () => {
    const definition = {
      id: 'us023-takeover',
      name: 'US-023 takeover visibility',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'human_takeover' as const,
          id: 'pause_for_login',
          reason: 'Please authenticate',
          instructions: 'Log in and continue.',
        },
      ],
    };

    const result = await workflowEngine.run(definition);

    expect(result.success).toBe(true);
    expect(mockHitlCoordinator.requestTakeover).toHaveBeenCalledWith(
      'Please authenticate',
      'Log in and continue.',
    );
    expect(mockHitlCoordinator.emit).toHaveBeenCalledWith(
      'phase_changed',
      expect.objectContaining({
        phase: 'awaiting_human',
        hitlAction: 'return_control',
        hitlReason: 'Please authenticate',
      }),
    );
  });

  it('publishes pii_wait with secure_input before sensitive type waits', async () => {
    const definition = {
      id: 'us023-sensitive-type',
      name: 'US-023 pii wait visibility',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'type' as const,
          id: 'enter_ssn',
          selector: '#ssn',
          text: 'unused',
          field: {
            id: 'ssn',
            label: 'SSN',
            kind: 'ssn' as const,
            sensitivity: 'spi' as const,
          },
        },
      ],
    };

    const result = await workflowEngine.run(definition);

    expect(result.success).toBe(true);
    expect(mockHitlCoordinator.requestSensitiveValue).toHaveBeenCalledWith(
      'SSN',
      'Secure HITL input required for sensitive data.',
    );
    expect(mockHitlCoordinator.emit).toHaveBeenCalledWith(
      'phase_changed',
      expect.objectContaining({
        phase: 'pii_wait',
        hitlAction: 'secure_input',
        hitlFieldLabel: 'SSN',
      }),
    );
    expect(mockSessionManager.type).toHaveBeenCalledWith('#ssn', '4111', undefined);
  });

  it('publishes hitl_qa with confirm_completion before final confirmation waits', async () => {
    const definition = {
      id: 'us023-confirmation',
      name: 'US-023 final confirmation visibility',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'human_takeover' as const,
          id: 'confirm_submit',
          mode: 'confirm_completion' as const,
          reason: 'Confirm the final submission',
          instructions: 'Verify the visible result before continuing.',
        },
      ],
    };

    const result = await workflowEngine.run(definition);

    expect(result.success).toBe(true);
    expect(mockHitlCoordinator.requestCompletionConfirmation).toHaveBeenCalledWith(
      'Confirm the final submission',
      'Verify the visible result before continuing.',
    );
    expect(mockHitlCoordinator.emit).toHaveBeenCalledWith(
      'phase_changed',
      expect.objectContaining({
        phase: 'hitl_qa',
        hitlAction: 'confirm_completion',
        hitlReason: 'Confirm the final submission',
      }),
    );
  });

  it('publishes complete through the canonical state path', async () => {
    const definition = {
      id: 'us023-complete',
      name: 'US-023 complete visibility',
      mode: 'direct' as const,
      params: {},
      steps: [],
    };

    const result = await workflowEngine.run(definition);

    expect(result.success).toBe(true);
    expect(mockHitlCoordinator.syncPhase).toHaveBeenCalledWith('complete');
    expect(mockHitlCoordinator.setPhase).not.toHaveBeenCalledWith('complete');
    expect(mockHitlCoordinator.emit).toHaveBeenCalledWith(
      'phase_changed',
      expect.objectContaining({
        phase: 'complete',
        completedSteps: 0,
      }),
    );
  });

  it('publishes error through the canonical state path when preflight bootstrap fails', async () => {
    process.env.AI_VISION_UI_PORT = '3010';
    mockWriter.writePost.mockRejectedValueOnce(new Error('Gemini failed'));

    const definition = {
      id: 'post_to_x',
      name: 'US-023 error visibility',
      mode: 'direct' as const,
      params: {
        post_text: { type: 'string' as const, required: true },
      },
      steps: [],
    };

    const result = await workflowEngine.run(definition, { topic: 'Need generated copy' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Gemini failed');
    expect(mockHitlCoordinator.syncPhase).toHaveBeenCalledWith('error');
    expect(mockHitlCoordinator.emit).toHaveBeenCalledWith(
      'phase_changed',
      expect.objectContaining({
        phase: 'error',
        error: 'Gemini failed',
      }),
    );
  });
});

describe('workflowEngine US-026 approval gate before side effects', () => {
  beforeAll(() => {
    workflowEngine = require('./engine').workflowEngine;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AI_VISION_UI_PORT;
    mockSessionManager.start.mockResolvedValue(undefined);
    mockSessionManager.currentUrl.mockResolvedValue('https://example.test/page');
    mockSessionManager.getPage.mockResolvedValue(mockPage);
    mockSessionManager.click.mockResolvedValue(undefined);
    mockSessionManager.extractCookies.mockResolvedValue([]);
    mockSessionManager.syncActivePage.mockResolvedValue(undefined);
    mockSessionManager.close.mockResolvedValue(undefined);
    mockSessionManager.startScreenshotTimer.mockReturnValue(undefined);
    mockSessionManager.stopScreenshotTimer.mockReturnValue(undefined);
    mockHitlCoordinator.requestQaPause.mockResolvedValue(undefined);
    mockAutomationEngine.runTask.mockResolvedValue({
      success: true,
      output: 'agent ok',
      screenshots: [],
      durationMs: 7,
    });
  });

  it('publishes hitl_qa approve_step and blocks a protected click until approval', async () => {
    const callOrder: string[] = [];
    mockHitlCoordinator.requestQaPause.mockImplementation(async () => {
      callOrder.push('approval_wait');
      expect(mockSessionManager.click).not.toHaveBeenCalled();
    });
    mockSessionManager.click.mockImplementation(async () => {
      callOrder.push('click');
    });

    const definition = {
      id: 'us026-click',
      name: 'US-026 protected click',
      mode: 'direct' as const,
      permissions: {
        require_human_approval_before: ['submit_step'],
      },
      params: {},
      steps: [
        {
          type: 'click' as const,
          id: 'submit_step',
          description: 'Submit Draft',
          selector: '#submit',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {}, 'sess-approval-1');

    expect(result.success).toBe(true);
    expect(callOrder).toEqual(['approval_wait', 'click']);
    expect(mockHitlCoordinator.emit).toHaveBeenCalledWith(
      'phase_changed',
      expect.objectContaining({
        phase: 'hitl_qa',
        hitlAction: 'approve_step',
        currentStep: 'submit_step',
        hitlReason: 'Approval required before protected step: Submit Draft',
      }),
    );
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.gate.approval.required', stepId: 'submit_step' }),
    );
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.gate.approval.waiting', stepId: 'submit_step' }),
    );
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.gate.approval.approved', stepId: 'submit_step' }),
    );
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.gate.approval.consumed', stepId: 'submit_step' }),
    );
  });

  it('executes an unprotected click without an approval pause', async () => {
    const definition = {
      id: 'us026-unprotected',
      name: 'US-026 unprotected click',
      mode: 'direct' as const,
      permissions: {
        require_human_approval_before: ['agent_task'],
      },
      params: {},
      steps: [
        {
          type: 'click' as const,
          id: 'plain_click',
          selector: '#continue',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {}, 'sess-approval-2');

    expect(result.success).toBe(true);
    expect(mockHitlCoordinator.requestQaPause).not.toHaveBeenCalled();
    expect(mockSessionManager.click).toHaveBeenCalledWith('#continue');
  });

  it('consumes approval after a protected step and requires a new approval for the next protected step', async () => {
    const definition = {
      id: 'us026-consume',
      name: 'US-026 consumed approval',
      mode: 'direct' as const,
      permissions: {
        require_human_approval_before: ['click'],
      },
      params: {},
      steps: [
        { type: 'click' as const, id: 'first_click', selector: '#first' },
        { type: 'click' as const, id: 'second_click', selector: '#second' },
      ],
    };

    const result = await workflowEngine.run(definition, {}, 'sess-approval-3');

    expect(result.success).toBe(true);
    expect(mockHitlCoordinator.requestQaPause).toHaveBeenCalledTimes(2);
    const consumedEvents = mockTelemetry.emit.mock.calls.filter(
      ([event]) => event.name === 'workflow.gate.approval.consumed',
    );
    expect(consumedEvents).toHaveLength(2);
  });

  it('scopes approval to one run and requires approval again on the next run', async () => {
    const definition = {
      id: 'us026-run-scope',
      name: 'US-026 approval scope',
      mode: 'direct' as const,
      permissions: {
        require_human_approval_before: ['protected_click'],
      },
      params: {},
      steps: [
        { type: 'click' as const, id: 'protected_click', selector: '#submit' },
      ],
    };

    await workflowEngine.run(definition, {}, 'sess-approval-4a');
    await workflowEngine.run(definition, {}, 'sess-approval-4b');

    expect(mockHitlCoordinator.requestQaPause).toHaveBeenCalledTimes(2);
  });

  it('prevents protected agent_task steps from reaching the worker before approval', async () => {
    const callOrder: string[] = [];
    mockHitlCoordinator.requestQaPause.mockImplementation(async () => {
      callOrder.push('approval_wait');
      expect(mockAutomationEngine.runTask).not.toHaveBeenCalled();
    });
    mockAutomationEngine.runTask.mockImplementation(async () => {
      callOrder.push('agent_task');
      return {
        success: true,
        output: 'agent ok',
        screenshots: [],
        durationMs: 7,
      };
    });

    const definition = {
      id: 'us026-agent-task',
      name: 'US-026 protected agent task',
      mode: 'direct' as const,
      permissions: {
        require_human_approval_before: ['agent_task'],
      },
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'publish_agent_step',
          prompt: 'Navigate and submit the draft',
          engine: 'browser-use' as const,
        },
      ],
    };

    const result = await workflowEngine.run(definition, {}, 'sess-approval-5');

    expect(result.success).toBe(true);
    expect(callOrder).toEqual(['approval_wait', 'agent_task']);
    expect(mockRegistry.getReady).toHaveBeenCalledWith('browser-use');
  });
});

describe('workflowEngine US-027 content output validation gate', () => {
  beforeAll(() => {
    workflowEngine = require('./engine').workflowEngine;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AI_VISION_UI_PORT;
    mockSessionManager.start.mockResolvedValue(undefined);
    mockSessionManager.currentUrl.mockResolvedValue('https://example.test/page');
    mockSessionManager.getPage.mockResolvedValue(mockPage);
    mockSessionManager.click.mockResolvedValue(undefined);
    mockSessionManager.extractCookies.mockResolvedValue([]);
    mockSessionManager.syncActivePage.mockResolvedValue(undefined);
    mockSessionManager.close.mockResolvedValue(undefined);
    mockSessionManager.startScreenshotTimer.mockReturnValue(undefined);
    mockSessionManager.stopScreenshotTimer.mockReturnValue(undefined);
    mockHitlCoordinator.requestQaPause.mockResolvedValue(undefined);
    mockPage.evaluate.mockResolvedValue('Rendered page body');
    mockAutomationEngine.runTask.mockResolvedValue({
      success: true,
      output: 'agent ok',
      screenshots: [],
      durationMs: 7,
    });
  });

  it('generate_content empty body fails fast', async () => {
    mockWriter.writePost.mockResolvedValueOnce({
      text: '',
      platform: 'x',
      model: 'gemini-test',
    });

    const definition = {
      id: 'us027-empty-body',
      name: 'US-027 empty body validation',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'generate_content' as const,
          id: 'write_post',
          topic: 'Test topic',
          platform: 'x' as const,
          outputKey: 'post_body',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Content validation failed');
    expect(result.error).toContain('post_body');
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.output_validation.failed', stepId: 'write_post' }),
    );
  });

  it('generate_content whitespace-only body fails fast', async () => {
    mockWriter.writePost.mockResolvedValueOnce({
      text: '   \n\t  ',
      platform: 'x',
      model: 'gemini-test',
    });

    const definition = {
      id: 'us027-whitespace-body',
      name: 'US-027 whitespace body validation',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'generate_content' as const,
          id: 'write_post',
          topic: 'Test topic',
          platform: 'x' as const,
          outputKey: 'post_body',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Content validation failed');
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.output_validation.failed', stepId: 'write_post' }),
    );
  });

  it('generate_content body with unresolved placeholder fails fast', async () => {
    mockWriter.writePost.mockResolvedValueOnce({
      text: 'Post about {{unresolved_topic}} here.',
      platform: 'x',
      model: 'gemini-test',
    });

    const definition = {
      id: 'us027-placeholder-body',
      name: 'US-027 placeholder body validation',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'generate_content' as const,
          id: 'write_post',
          topic: 'Test topic',
          platform: 'x' as const,
          outputKey: 'post_body',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Content validation failed');
    expect(result.error).toContain('post_body');
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.output_validation.failed', stepId: 'write_post' }),
    );
  });

  it('generate_content body containing TODO fails fast', async () => {
    mockWriter.writePost.mockResolvedValueOnce({
      text: 'TODO: write something here',
      platform: 'x',
      model: 'gemini-test',
    });

    const definition = {
      id: 'us027-todo-body',
      name: 'US-027 TODO body validation',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'generate_content' as const,
          id: 'write_post',
          topic: 'Test topic',
          platform: 'x' as const,
          outputKey: 'post_body',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Content validation failed');
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.output_validation.failed', stepId: 'write_post' }),
    );
  });

  it('generate_content missing required title fails fast', async () => {
    mockWriter.writePost.mockResolvedValueOnce({
      text: 'Valid body content here about ai-vision workflow gates.',
      // title is absent — writer did not generate one
      platform: 'reddit',
      model: 'gemini-test',
    });

    const definition = {
      id: 'us027-missing-title',
      name: 'US-027 missing title validation',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'generate_content' as const,
          id: 'write_post',
          topic: 'Test topic',
          platform: 'reddit' as const,
          outputKey: 'post_body',
          outputTitleKey: 'post_title',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Content validation failed');
    expect(result.error).toContain('post_title');
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.output_validation.failed', stepId: 'write_post' }),
    );
  });

  it('generate_content invalid required title fails fast', async () => {
    mockWriter.writePost.mockResolvedValueOnce({
      text: 'Valid body content here about ai-vision workflow gates.',
      title: '[Generated Title Here]',
      platform: 'reddit',
      model: 'gemini-test',
    });

    const definition = {
      id: 'us027-invalid-title',
      name: 'US-027 invalid title validation',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'generate_content' as const,
          id: 'write_post',
          topic: 'Test topic',
          platform: 'reddit' as const,
          outputKey: 'post_body',
          outputTitleKey: 'post_title',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Content validation failed');
    expect(result.error).toContain('post_title');
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.output_validation.failed', stepId: 'write_post' }),
    );
  });

  it('preflight-provided invalid output fails before generation skip', async () => {
    process.env.AI_VISION_UI_PORT = '3010';
    // Bootstrap writes invalid content into outputs
    mockWriter.writePost.mockResolvedValueOnce({
      text: 'TODO',
      platform: 'reddit',
      model: 'gemini-test',
    });
    mockHitlCoordinator.requestQaPause.mockResolvedValue(undefined);

    const definition = {
      id: 'post_to_reddit',
      name: 'Preflight invalid content test',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'generate_content' as const,
          id: 'write_reddit_body',
          topic: 'Test topic',
          platform: 'reddit' as const,
          outputKey: 'reddit_post_text',
        },
      ],
    };

    const result = await workflowEngine.run(definition, { topic: 'Test topic' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Preflight content validation failed');
    expect(result.error).toContain('reddit_post_text');
    // Bootstrap ran the writer once; generate_content step must NOT call it again
    expect(mockWriter.writePost).toHaveBeenCalledTimes(1);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.output_validation.failed' }),
    );
  });

  it('downstream unresolved placeholder in agent_task fails before registry.getReady', async () => {
    const definition = {
      id: 'us027-downstream-agent',
      name: 'US-027 downstream placeholder agent_task',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'post_content',
          prompt: 'Post this content: {{unresolved_output_key}}',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('unresolved placeholders');
    expect(result.error).toContain('post_content');
    expect(mockRegistry.getReady).not.toHaveBeenCalled();
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.output_validation.failed',
        stepId: 'post_content',
      }),
    );
  });

  it('downstream unresolved placeholder in fill fails before browser interaction', async () => {
    const definition = {
      id: 'us027-downstream-fill',
      name: 'US-027 downstream placeholder fill',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'fill' as const,
          id: 'fill_content',
          selector: '#textarea',
          text: 'Content: {{missing_body_output}}',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('unresolved placeholders');
    expect(result.error).toContain('fill_content');
    expect(mockSessionManager.getPage).not.toHaveBeenCalled();
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.output_validation.failed',
        stepId: 'fill_content',
      }),
    );
  });

  it('valid ai-vision body and title pass validation and complete successfully', async () => {
    mockWriter.writePost.mockResolvedValueOnce({
      text: 'ai-vision HITL workflow gates are active and protecting all browser side effects from unverified actions.',
      title: 'ai-vision Workflow Update: HITL Approval Gates Active',
      platform: 'reddit',
      model: 'gemini-test',
    });

    const definition = {
      id: 'us027-valid-content',
      name: 'US-027 valid content passes',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'generate_content' as const,
          id: 'write_post',
          topic: 'ai-vision workflow update',
          platform: 'reddit' as const,
          outputKey: 'post_body',
          outputTitleKey: 'post_title',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {});

    expect(result.success).toBe(true);
    expect(result.outputs.post_body).toBe(
      'ai-vision HITL workflow gates are active and protecting all browser side effects from unverified actions.',
    );
    expect(result.outputs.post_title).toBe('ai-vision Workflow Update: HITL Approval Gates Active');
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.output_validation.passed',
        stepId: 'write_post',
      }),
    );
    expect(mockTelemetry.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.output_validation.failed' }),
    );
  });
});

// ---------------------------------------------------------------------------
// US-030 / RF-012 — Generalized precondition/skip gate
// ---------------------------------------------------------------------------

describe('workflowEngine US-030 precondition skip gate', () => {
  beforeAll(() => {
    workflowEngine = require('./engine').workflowEngine;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AI_VISION_UI_PORT;
    mockSessionManager.start.mockResolvedValue(undefined);
    mockSessionManager.currentUrl.mockResolvedValue('https://example.test/page');
    mockSessionManager.navigate.mockResolvedValue(undefined);
    mockSessionManager.getPage.mockResolvedValue(mockPage);
    mockSessionManager.click.mockResolvedValue(undefined);
    mockSessionManager.extractCookies.mockResolvedValue([]);
    mockSessionManager.syncActivePage.mockResolvedValue(undefined);
    mockSessionManager.close.mockResolvedValue(undefined);
    mockSessionManager.startScreenshotTimer.mockReturnValue(undefined);
    mockSessionManager.stopScreenshotTimer.mockReturnValue(undefined);
    mockHitlCoordinator.requestQaPause.mockResolvedValue(undefined);
    mockHitlCoordinator.requestTakeover.mockResolvedValue(undefined);
    mockPage.evaluate.mockResolvedValue('Rendered page body');
    (mockPage as { waitForTimeout?: jest.Mock }).waitForTimeout = jest.fn().mockResolvedValue(undefined);
    mockWriter.writePost.mockResolvedValue({
      text: 'Generated content body',
      platform: 'x',
      model: 'gemini-test',
    });
  });

  it('authenticated human_takeover with authVerification skips before HITL wait publication', async () => {
    mockSessionManager.currentUrl.mockResolvedValue('https://www.reddit.com/r/test/submit');

    const definition = {
      id: 'us030-auth-skip',
      name: 'US-030 auth skip',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'human_takeover' as const,
          id: 'reddit_login',
          reason: 'Verify Reddit login',
          authVerification: {
            urlIncludes: ['reddit.com/r/test/submit'],
          },
        },
      ],
    };

    const result = await workflowEngine.run(definition);

    expect(result.success).toBe(true);
    expect(mockHitlCoordinator.requestTakeover).not.toHaveBeenCalled();
    expect(result.stepResults[0].success).toBe(true);
    expect(result.stepResults[0].output).toContain('auth_verification_satisfied');
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.precondition.skipped', stepId: 'reddit_login' }),
    );
    expect(mockHitlCoordinator.emit).not.toHaveBeenCalledWith(
      'phase_changed',
      expect.objectContaining({ hitlAction: 'verify_authentication' }),
    );
  });

  it('unauthenticated human_takeover with authVerification still publishes HITL wait', async () => {
    mockSessionManager.currentUrl.mockResolvedValue('https://example.test/login');

    const definition = {
      id: 'us030-auth-run',
      name: 'US-030 auth run',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'human_takeover' as const,
          id: 'reddit_login',
          reason: 'Verify Reddit login',
          authVerification: {
            urlIncludes: ['reddit.com/r/test/submit'],
          },
        },
      ],
    };

    const result = await workflowEngine.run(definition);

    expect(result.success).toBe(true);
    expect(mockHitlCoordinator.requestTakeover).toHaveBeenCalled();
    expect(mockHitlCoordinator.emit).toHaveBeenCalledWith(
      'phase_changed',
      expect.objectContaining({ phase: 'awaiting_human', hitlAction: 'verify_authentication' }),
    );
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.precondition.evaluated', stepId: 'reddit_login' }),
    );
  });

  it('generate_content skips writer invocation when valid output already exists', async () => {
    mockPage.evaluate.mockResolvedValue('ai-vision valid seeded content');

    const definition = {
      id: 'us030-generate-skip',
      name: 'US-030 generate skip',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'extract' as const,
          id: 'seed_output',
          instruction: 'seed output',
          outputKey: 'post_body',
        },
        {
          type: 'generate_content' as const,
          id: 'write_post',
          topic: 'Test topic',
          platform: 'x' as const,
          outputKey: 'post_body',
        },
      ],
    };

    const result = await workflowEngine.run(definition);

    expect(result.success).toBe(true);
    expect(mockWriter.writePost).not.toHaveBeenCalled();
    expect(result.stepResults[1].success).toBe(true);
    expect(result.stepResults[1].output).toContain('preflight_output_present');
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.precondition.skipped', stepId: 'write_post' }),
    );
  });

  it('generate_content fails when preflight output exists but is invalid', async () => {
    mockPage.evaluate.mockResolvedValue('TODO');

    const definition = {
      id: 'us030-generate-fail',
      name: 'US-030 generate invalid preflight',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'extract' as const,
          id: 'seed_invalid_output',
          instruction: 'seed invalid output',
          outputKey: 'post_body',
        },
        {
          type: 'generate_content' as const,
          id: 'write_post',
          topic: 'Test topic',
          platform: 'x' as const,
          outputKey: 'post_body',
        },
      ],
    };

    const result = await workflowEngine.run(definition);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Preflight content validation failed');
    expect(mockWriter.writePost).not.toHaveBeenCalled();
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.precondition.failed', stepId: 'write_post' }),
    );
  });

  it('navigate skips when current URL already matches the target URL', async () => {
    mockSessionManager.currentUrl.mockResolvedValue('https://example.test/page');

    const definition = {
      id: 'us030-navigate-skip',
      name: 'US-030 navigate skip',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'navigate' as const,
          id: 'already_on_page',
          url: 'https://example.test/page',
        },
      ],
    };

    const result = await workflowEngine.run(definition);

    expect(result.success).toBe(true);
    expect(mockSessionManager.navigate).not.toHaveBeenCalled();
    expect(result.stepResults[0].success).toBe(true);
    expect(result.stepResults[0].output).toContain('already_at_target_url');
  });

  it('navigate runs when current URL does not match the target URL', async () => {
    mockSessionManager.currentUrl.mockResolvedValue('https://example.test/landing');

    const definition = {
      id: 'us030-navigate-run',
      name: 'US-030 navigate run',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'navigate' as const,
          id: 'go_to_page',
          url: 'https://example.test/page',
        },
      ],
    };

    const result = await workflowEngine.run(definition);

    expect(result.success).toBe(true);
    expect(mockSessionManager.navigate).toHaveBeenCalledWith('https://example.test/page', 'load');
  });

  it('precondition failure telemetry is emitted for unresolved downstream placeholders', async () => {
    const definition = {
      id: 'us030-unresolved-placeholder',
      name: 'US-030 unresolved placeholder telemetry',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'click' as const,
          id: 'click_missing',
          selector: '#{{missing_selector}}',
        },
      ],
    };

    const result = await workflowEngine.run(definition);

    expect(result.success).toBe(false);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.precondition.failed', stepId: 'click_missing' }),
    );
  });
});

// ---------------------------------------------------------------------------
// US-028 / RF-010 — Reddit duplicate-check deterministic evidence gate
// ---------------------------------------------------------------------------

const VALID_DUPLICATE_EVIDENCE = [
  'EXTRACTED_TITLES: ["Old Post One","Another Post Title"]',
  'OVERLAP_SCORES: [{"title":"Old Post One","score":0.05},{"title":"Another Post Title","score":0.10}]',
  'DUPLICATE_CHECK_RESULT: NO_DUPLICATE_FOUND',
].join('\n');

const DUPLICATE_RISK_EVIDENCE = [
  'EXTRACTED_TITLES: ["ai-vision Workflow Update: HITL Approval Gates Active"]',
  'OVERLAP_SCORES: [{"title":"ai-vision Workflow Update: HITL Approval Gates Active","score":0.85}]',
  'DUPLICATE_CHECK_RESULT: DUPLICATE_RISK',
  'MATCHING_TITLE: ai-vision Workflow Update: HITL Approval Gates Active',
].join('\n');

const DUPLICATE_CHECK_THEN_SUBMIT_STEPS = [
  {
    type: 'agent_task' as const,
    id: 'check_duplicate_reddit_post',
    engine: 'browser-use' as const,
    rawPrompt: true as const,
    prompt: 'Duplicate check for {{post_title}} on r/{{subreddit}}',
  },
  {
    type: 'agent_task' as const,
    id: 'submit_reddit_post',
    engine: 'browser-use' as const,
    prompt: 'Click Post and confirm publish',
  },
];

function loadLiveWorkflowPrompt(stepId: string): string {
  const workflowPath = path.resolve(__dirname, '../../workflows/post_to_reddit.yaml');
  const doc = yaml.load(fs.readFileSync(workflowPath, 'utf8')) as {
    steps?: Array<{ id?: string; prompt?: string }>;
  };
  const step = doc.steps?.find(s => s.id === stepId);
  if (!step || typeof step.prompt !== 'string') {
    throw new Error(`Missing prompt for step '${stepId}' in workflows/post_to_reddit.yaml`);
  }
  return step.prompt;
}

const LIVE_CHECK_DUPLICATE_REDDIT_PROMPT = loadLiveWorkflowPrompt('check_duplicate_reddit_post');
const LIVE_SUBMIT_REDDIT_PROMPT = loadLiveWorkflowPrompt('submit_reddit_post');

describe('reddit duplicate helper functions', () => {
  it('normalizes titles into lowercase deduplicated tokens', () => {
    expect(normalizeRedditTitle('  Hello, HELLO   world!! ')).toEqual(['hello', 'world']);
  });

  it('drops empty strings, UI labels, and case-insensitive duplicates while preserving first-seen titles', () => {
    expect(collectUsableRedditTitles([
      '',
      'Comment',
      'Useful Reddit Title',
      'useful reddit title',
      'Share',
      'Another Title',
    ])).toEqual(['Useful Reddit Title', 'Another Title']);
  });

  it('renders duplicate risk at jaccard >= 0.70', () => {
    const overlapScores = buildRedditOverlapScores(
      'AI vision duplicate guard',
      ['AI vision duplicate guard', 'Completely unrelated post'],
    );

    const rendered = renderRedditDuplicateEvidence({
      extractedTitles: ['AI vision duplicate guard', 'Completely unrelated post'],
      overlapScores,
    });

    expect(rendered).toContain('DUPLICATE_CHECK_RESULT: DUPLICATE_RISK');
    expect(rendered).toContain('MATCHING_TITLE: AI vision duplicate guard');
  });

  it('keeps near-match scores visible without creating a third canonical result', () => {
    const overlapScores = buildRedditOverlapScores(
      'ai vision release roadmap',
      ['ai vision release notes', 'something fully different'],
    );

    expect(overlapScores[0].score).toBeGreaterThanOrEqual(0.5);
    expect(overlapScores[0].score).toBeLessThan(0.7);

    const rendered = renderRedditDuplicateEvidence({
      extractedTitles: ['ai vision release notes', 'something fully different'],
      overlapScores,
    });

    expect(rendered).toContain('DUPLICATE_CHECK_RESULT: NO_DUPLICATE_FOUND');
    expect(rendered).not.toContain('NEAR_MATCH_REVIEW');
  });
});

describe('workflowEngine US-028 Reddit duplicate-check evidence gate', () => {
  let currentUrl = 'https://www.reddit.com/r/test/submit';

  beforeAll(() => {
    workflowEngine = require('./engine').workflowEngine;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AI_VISION_UI_PORT;
    mockSessionManager.start.mockResolvedValue(undefined);
    currentUrl = 'https://www.reddit.com/r/test/submit';
    mockSessionManager.currentUrl.mockImplementation(async () => currentUrl);
    mockSessionManager.navigate.mockImplementation(async (url: string) => {
      currentUrl = url;
    });
    mockSessionManager.getPage.mockResolvedValue(mockPage);
    mockSessionManager.click.mockResolvedValue(undefined);
    mockSessionManager.extractCookies.mockResolvedValue([]);
    mockSessionManager.syncActivePage.mockResolvedValue(undefined);
    mockSessionManager.close.mockResolvedValue(undefined);
    mockSessionManager.startScreenshotTimer.mockReturnValue(undefined);
    mockSessionManager.stopScreenshotTimer.mockReturnValue(undefined);
    mockHitlCoordinator.requestQaPause.mockResolvedValue(undefined);
    mockPage.evaluate.mockResolvedValue('Rendered page body');
    mockAutomationEngine.runTask.mockResolvedValue({
      success: true,
      output: 'agent ok',
      screenshots: [],
      durationMs: 7,
    });
  });

  it('valid NO_DUPLICATE_FOUND evidence with extracted titles and overlap scores allows submit path', async () => {
    // check step returns valid evidence; submit step succeeds
    mockAutomationEngine.runTask
      .mockResolvedValueOnce({ success: true, output: VALID_DUPLICATE_EVIDENCE, screenshots: [], durationMs: 5 })
      .mockImplementationOnce(async () => {
        currentUrl = 'https://www.reddit.com/r/test/comments/abc123/new-ai-vision-post/';
        return {
          success: true,
          output: 'Final URL: https://www.reddit.com/r/test/comments/abc123/new-ai-vision-post/',
          screenshots: [],
          durationMs: 10,
        };
      });

    const definition = {
      id: 'us028-valid-no-duplicate',
      name: 'US-028 valid no-duplicate allows submit',
      mode: 'direct' as const,
      params: { post_title: { type: 'string' as const }, subreddit: { type: 'string' as const } },
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, { post_title: 'New ai-vision Post', subreddit: 'test' });

    expect(result.success).toBe(true);
    expect(mockRegistry.getReady).toHaveBeenCalledTimes(2);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.reddit_duplicate_check.evidence_parsed' }),
    );
    expect(mockTelemetry.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.reddit_duplicate_check.evidence_failed' }),
    );
    expect(mockTelemetry.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.reddit_duplicate_check.duplicate_risk' }),
    );
  });

  it('parsed evidence is written to workflow outputs', async () => {
    mockAutomationEngine.runTask
      .mockResolvedValueOnce({ success: true, output: VALID_DUPLICATE_EVIDENCE, screenshots: [], durationMs: 5 })
      .mockImplementationOnce(async () => {
        currentUrl = 'https://www.reddit.com/r/test/comments/abc123/new-post/';
        return {
          success: true,
          output: 'Final URL: https://www.reddit.com/r/test/comments/abc123/new-post/',
          screenshots: [],
          durationMs: 10,
        };
      });

    const definition = {
      id: 'us028-outputs',
      name: 'US-028 evidence stored in outputs',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, { post_title: 'New Post', subreddit: 'test' });

    expect(result.outputs['reddit_duplicate_check_result']).toBe('NO_DUPLICATE_FOUND');
    expect(result.outputs['reddit_duplicate_check_evidence']).toContain('EXTRACTED_TITLES');
    expect(result.outputs['reddit_duplicate_matching_title']).toBeUndefined();
  });

  it('DUPLICATE_RISK evidence blocks submit_reddit_post', async () => {
    mockAutomationEngine.runTask.mockResolvedValueOnce({
      success: true,
      output: DUPLICATE_RISK_EVIDENCE,
      screenshots: [],
      durationMs: 5,
    });

    const definition = {
      id: 'us028-duplicate-risk',
      name: 'US-028 duplicate risk blocks submit',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, { post_title: 'ai-vision Workflow Update: HITL Approval Gates Active', subreddit: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('duplicate risk');
    // submit step must not have been called
    expect(mockRegistry.getReady).toHaveBeenCalledTimes(1);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.reddit_duplicate_check.duplicate_risk' }),
    );
  });

  it('duplicate risk evidence stores matching title in outputs', async () => {
    mockAutomationEngine.runTask.mockResolvedValueOnce({
      success: true,
      output: DUPLICATE_RISK_EVIDENCE,
      screenshots: [],
      durationMs: 5,
    });

    // Only the check step — no submit step — so DUPLICATE_RISK is stored but doesn't fail yet
    const definition = {
      id: 'us028-matching-title-stored',
      name: 'US-028 matching title stored in outputs',
      mode: 'direct' as const,
      params: {},
      steps: [DUPLICATE_CHECK_THEN_SUBMIT_STEPS[0]],
    };

    const result = await workflowEngine.run(definition, { post_title: 'ai-vision Workflow Update: HITL Approval Gates Active', subreddit: 'test' });

    // Check step succeeds — DUPLICATE_RISK is only rejected at the submit gate
    expect(result.success).toBe(true);
    expect(result.outputs['reddit_duplicate_check_result']).toBe('DUPLICATE_RISK');
    expect(result.outputs['reddit_duplicate_matching_title']).toBe(
      'ai-vision Workflow Update: HITL Approval Gates Active',
    );
  });

  it('missing duplicate evidence blocks submit_reddit_post', async () => {
    const definition = {
      id: 'us028-missing-evidence',
      name: 'US-028 missing evidence blocks submit',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'submit_reddit_post',
          engine: 'browser-use' as const,
          prompt: 'Click Post and confirm publish',
        },
      ],
    };

    const result = await workflowEngine.run(definition, { post_title: 'Test', subreddit: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('no duplicate-check evidence');
    expect(mockRegistry.getReady).not.toHaveBeenCalled();
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.reddit_duplicate_check.evidence_failed' }),
    );
  });

  it('missing extracted titles blocks submit_reddit_post', async () => {
    const badEvidence = [
      'OVERLAP_SCORES: [{"title":"Old Post","score":0.05}]',
      'DUPLICATE_CHECK_RESULT: NO_DUPLICATE_FOUND',
    ].join('\n');

    mockAutomationEngine.runTask.mockResolvedValueOnce({
      success: true,
      output: badEvidence,
      screenshots: [],
      durationMs: 5,
    });

    const definition = {
      id: 'us028-missing-titles',
      name: 'US-028 missing extracted titles',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, { post_title: 'Test', subreddit: 'test' });

    expect(result.success).toBe(false);
    expect(mockRegistry.getReady).toHaveBeenCalledTimes(1); // check step ran, submit did not
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.reddit_duplicate_check.evidence_failed' }),
    );
  });

  it('missing overlap scores blocks submit_reddit_post', async () => {
    const badEvidence = [
      'EXTRACTED_TITLES: ["Old Post One"]',
      'DUPLICATE_CHECK_RESULT: NO_DUPLICATE_FOUND',
    ].join('\n');

    mockAutomationEngine.runTask.mockResolvedValueOnce({
      success: true,
      output: badEvidence,
      screenshots: [],
      durationMs: 5,
    });

    const definition = {
      id: 'us028-missing-scores',
      name: 'US-028 missing overlap scores',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, { post_title: 'Test', subreddit: 'test' });

    expect(result.success).toBe(false);
    expect(mockRegistry.getReady).toHaveBeenCalledTimes(1);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.reddit_duplicate_check.evidence_failed' }),
    );
  });

  it('score >= 0.70 with NO_DUPLICATE_FOUND blocks submit_reddit_post', async () => {
    const highScoreEvidence = [
      'EXTRACTED_TITLES: ["ai-vision Workflow Update: HITL Approval Gates Active"]',
      'OVERLAP_SCORES: [{"title":"ai-vision Workflow Update: HITL Approval Gates Active","score":0.72}]',
      'DUPLICATE_CHECK_RESULT: NO_DUPLICATE_FOUND',
    ].join('\n');

    mockAutomationEngine.runTask.mockResolvedValueOnce({
      success: true,
      output: highScoreEvidence,
      screenshots: [],
      durationMs: 5,
    });

    const definition = {
      id: 'us028-high-score-no-duplicate',
      name: 'US-028 high score contradicts NO_DUPLICATE_FOUND',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, { post_title: 'ai-vision Workflow Update: HITL Approval Gates Active', subreddit: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('0.70');
    expect(mockRegistry.getReady).toHaveBeenCalledTimes(1);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.reddit_duplicate_check.evidence_failed' }),
    );
  });

  it('invalid score outside 0..1 blocks submit_reddit_post', async () => {
    const invalidScoreEvidence = [
      'EXTRACTED_TITLES: ["Some Post Title"]',
      'OVERLAP_SCORES: [{"title":"Some Post Title","score":1.5}]',
      'DUPLICATE_CHECK_RESULT: NO_DUPLICATE_FOUND',
    ].join('\n');

    mockAutomationEngine.runTask.mockResolvedValueOnce({
      success: true,
      output: invalidScoreEvidence,
      screenshots: [],
      durationMs: 5,
    });

    const definition = {
      id: 'us028-invalid-score',
      name: 'US-028 invalid score range',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, { post_title: 'Test', subreddit: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('range');
    expect(mockRegistry.getReady).toHaveBeenCalledTimes(1);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.reddit_duplicate_check.evidence_failed' }),
    );
  });

  it('duplicate-check telemetry emits evidence_parsed for valid output', async () => {
    mockAutomationEngine.runTask
      .mockResolvedValueOnce({ success: true, output: VALID_DUPLICATE_EVIDENCE, screenshots: [], durationMs: 5 })
      .mockImplementationOnce(async () => {
        currentUrl = 'https://www.reddit.com/r/test/comments/abc123/new-post/';
        return {
          success: true,
          output: 'Final URL: https://www.reddit.com/r/test/comments/abc123/new-post/',
          screenshots: [],
          durationMs: 5,
        };
      });

    const definition = {
      id: 'us028-telemetry-parsed',
      name: 'US-028 telemetry evidence_parsed',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    await workflowEngine.run(definition, { post_title: 'New Post', subreddit: 'test' });

    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.reddit_duplicate_check.evidence_parsed',
        stepId: 'check_duplicate_reddit_post',
      }),
    );
  });

  it('direct post_to_reddit uses deterministic duplicate evidence instead of browser-use dispatch', async () => {
    mockPage.evaluate
      .mockResolvedValueOnce([
        'Useful Existing Post',
        'Another Existing Post',
      ]);

    mockAutomationEngine.runTask.mockImplementationOnce(async () => {
      currentUrl = 'https://www.reddit.com/r/test/comments/abc123/new-post/';
      return {
        success: true,
        output: 'Final URL: https://www.reddit.com/r/test/comments/abc123/new-post/',
        screenshots: [],
        durationMs: 10,
      };
    });

    const definition = {
      id: 'post_to_reddit',
      name: 'Direct post_to_reddit deterministic duplicate check',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, { post_title: 'Fresh Reddit Idea', subreddit: 'test' });

    expect(result.success).toBe(true);
    expect(mockRegistry.getReady).toHaveBeenCalledTimes(1);
    expect(mockSessionManager.navigate).toHaveBeenCalledWith('https://www.reddit.com/r/test/new', 'domcontentloaded');
    expect(mockSessionManager.navigate).toHaveBeenCalledWith('https://www.reddit.com/r/test/submit', 'domcontentloaded');
    expect(result.outputs['reddit_duplicate_check_evidence']).toContain('EXTRACTED_TITLES: ["Useful Existing Post","Another Existing Post"]');
    expect(mockTelemetry.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.agent_task.routed',
        stepId: 'check_duplicate_reddit_post',
        details: expect.objectContaining({ engineId: 'browser-use' }),
      }),
    );
  });

  it('selector fallback works when the primary selector has no usable titles', async () => {
    mockPage.evaluate
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['Recovered Title From Fallback']);

    const definition = {
      id: 'post_to_reddit',
      name: 'Direct fallback duplicate check',
      mode: 'direct' as const,
      params: {},
      steps: [DUPLICATE_CHECK_THEN_SUBMIT_STEPS[0]],
    };

    const result = await workflowEngine.run(definition, { post_title: 'Fresh Reddit Idea', subreddit: 'test' });

    expect(result.success).toBe(true);
    expect(result.outputs['reddit_duplicate_check_evidence']).toContain('Recovered Title From Fallback');
    expect(mockRegistry.getReady).not.toHaveBeenCalled();
  });

  it('zero usable titles fails closed for direct post_to_reddit', async () => {
    mockPage.evaluate
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const definition = {
      id: 'post_to_reddit',
      name: 'Direct zero-title duplicate check',
      mode: 'direct' as const,
      params: {},
      steps: [DUPLICATE_CHECK_THEN_SUBMIT_STEPS[0]],
    };

    const result = await workflowEngine.run(definition, { post_title: 'Fresh Reddit Idea', subreddit: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('no usable titles collected');
    expect(mockRegistry.getReady).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// US-029 / RF-011 — Browser side-effect/postcondition gate
// ---------------------------------------------------------------------------

describe('workflowEngine US-029 browser postcondition gate', () => {
  let currentUrl = 'https://www.reddit.com/r/test/submit';

  beforeAll(() => {
    workflowEngine = require('./engine').workflowEngine;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AI_VISION_UI_PORT;
    mockSessionManager.start.mockResolvedValue(undefined);
    currentUrl = 'https://www.reddit.com/r/test/submit';
    mockSessionManager.currentUrl.mockImplementation(async () => currentUrl);
    mockSessionManager.getPage.mockResolvedValue(mockPage);
    mockSessionManager.click.mockResolvedValue(undefined);
    mockSessionManager.extractCookies.mockResolvedValue([]);
    mockSessionManager.syncActivePage.mockResolvedValue(undefined);
    mockSessionManager.close.mockResolvedValue(undefined);
    mockSessionManager.startScreenshotTimer.mockReturnValue(undefined);
    mockSessionManager.stopScreenshotTimer.mockReturnValue(undefined);
    mockHitlCoordinator.requestQaPause.mockResolvedValue(undefined);
    mockPage.evaluate.mockResolvedValue('Rendered page body');

    mockAutomationEngine.runTask.mockImplementation(async (_prompt: string, options?: { stepId?: string }) => {
      if (options?.stepId === 'check_duplicate_reddit_post') {
        currentUrl = 'https://www.reddit.com/r/test/submit';
        return { success: true, output: VALID_DUPLICATE_EVIDENCE, screenshots: [], durationMs: 5 };
      }
      if (options?.stepId === 'prepare_and_focus_body' || options?.stepId === 'draft_reddit_post') {
        currentUrl = 'https://www.reddit.com/r/test/submit';
        return {
          success: true,
          output: 'DRAFT_TITLE_TYPED: Test Title\nDRAFT_BODY_FOCUSED: YES',
          screenshots: [],
          durationMs: 5,
        };
      }
      if (options?.stepId === 'submit_reddit_post') {
        currentUrl = 'https://www.reddit.com/r/test/comments/abc123/test-title/';
        return {
          success: true,
          output: 'Final URL: https://www.reddit.com/r/test/comments/abc123/test-title/',
          screenshots: [],
          durationMs: 5,
        };
      }
      return { success: true, output: 'ok', screenshots: [], durationMs: 5 };
    });
  });

  it('submit_reddit_post passes when current URL and output both show a comments URL', async () => {
    const definition = {
      id: 'us029-submit-pass',
      name: 'US-029 submit postcondition pass',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, { post_title: 'Test Title', subreddit: 'test' });

    expect(result.success).toBe(true);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.browser_postcondition.passed', stepId: 'submit_reddit_post' }),
    );
  });

  it('submit_reddit_post fails when current URL remains on /submit', async () => {
    mockAutomationEngine.runTask.mockImplementation(async (_prompt: string, options?: { stepId?: string }) => {
      if (options?.stepId === 'check_duplicate_reddit_post') {
        return { success: true, output: VALID_DUPLICATE_EVIDENCE, screenshots: [], durationMs: 5 };
      }
      if (options?.stepId === 'submit_reddit_post') {
        return { success: true, output: 'Final URL: https://www.reddit.com/r/test/comments/abc123/test-title/', screenshots: [], durationMs: 5 };
      }
      return { success: true, output: 'ok', screenshots: [], durationMs: 5 };
    });

    const definition = {
      id: 'us029-submit-url-fail',
      name: 'US-029 submit URL fail',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, { post_title: 'Test Title', subreddit: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('expected_url_missing');
  });

  it('submit_reddit_post passes when current URL is already the canonical comments page even without output marker text', async () => {
    mockAutomationEngine.runTask.mockImplementation(async (_prompt: string, options?: { stepId?: string }) => {
      if (options?.stepId === 'check_duplicate_reddit_post') {
        return { success: true, output: VALID_DUPLICATE_EVIDENCE, screenshots: [], durationMs: 5 };
      }
      if (options?.stepId === 'submit_reddit_post') {
        currentUrl = 'https://www.reddit.com/r/test/comments/abc123/test-title/';
        return { success: true, output: 'Post submitted successfully', screenshots: [], durationMs: 5 };
      }
      return { success: true, output: 'ok', screenshots: [], durationMs: 5 };
    });

    const definition = {
      id: 'us029-submit-output-fail',
      name: 'US-029 submit output evidence fail',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, { post_title: 'Test Title', subreddit: 'test' });

    expect(result.success).toBe(true);
  });

  it('submit_reddit_post passes on created redirect when structured post-action evidence corroborates the published post', async () => {
    mockAutomationEngine.runTask.mockImplementation(async (_prompt: string, options?: { stepId?: string }) => {
      if (options?.stepId === 'check_duplicate_reddit_post') {
        currentUrl = 'https://www.reddit.com/r/test/submit';
        return { success: true, output: VALID_DUPLICATE_EVIDENCE, screenshots: [], durationMs: 5 };
      }
      if (options?.stepId === 'submit_reddit_post') {
        currentUrl = 'https://www.reddit.com/r/test/?created=t3_abc123';
        return {
          success: true,
          output: [
            'ACTION_TAKEN: clicked reddit post submit button',
            'OBSERVED_SUCCESS: true',
            'OBSERVED_SUCCESS_SIGNAL: canonical_comments_url',
            'CREATED_ID: t3_abc123',
            'CANONICAL_URL: https://www.reddit.com/r/test/comments/abc123/test-title/',
            'CURRENT_URL: https://www.reddit.com/r/test/?created=t3_abc123',
            'VISIBLE_TITLE: Test Title',
            'VISIBLE_BODY_EXCERPT: body text for reddit publish validation',
            'CONFIDENCE: high',
          ].join('\n'),
          screenshots: [],
          durationMs: 5,
        };
      }
      return { success: true, output: 'ok', screenshots: [], durationMs: 5 };
    });

    const definition = {
      id: 'us043-submit-created-pass',
      name: 'US-043 created redirect pass',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, {
      post_title: 'Test Title',
      post_text: 'body text for reddit publish validation',
      subreddit: 'test',
    });

    expect(result.success).toBe(true);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.post_action_review.evidence_accepted', stepId: 'submit_reddit_post' }),
    );
  });

  it('submit_reddit_post fails closed on malformed structured post-action evidence', async () => {
    mockAutomationEngine.runTask.mockImplementation(async (_prompt: string, options?: { stepId?: string }) => {
      if (options?.stepId === 'check_duplicate_reddit_post') {
        currentUrl = 'https://www.reddit.com/r/test/submit';
        return { success: true, output: VALID_DUPLICATE_EVIDENCE, screenshots: [], durationMs: 5 };
      }
      if (options?.stepId === 'submit_reddit_post') {
        currentUrl = 'https://www.reddit.com/r/test/?created=t3_abc123';
        return {
          success: true,
          output: [
            'OBSERVED_SUCCESS: maybe',
            'CANONICAL_URL: https://www.reddit.com/r/test/comments/abc123/test-title/',
            'VISIBLE_TITLE: Test Title',
            'VISIBLE_BODY_EXCERPT: body text for reddit publish validation',
            'CONFIDENCE: extreme',
          ].join('\n'),
          screenshots: [],
          durationMs: 5,
        };
      }
      return { success: true, output: 'ok', screenshots: [], durationMs: 5 };
    });

    const definition = {
      id: 'us043-submit-malformed-evidence',
      name: 'US-043 malformed evidence fail closed',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, {
      post_title: 'Test Title',
      post_text: 'body text for reddit publish validation',
      subreddit: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('expected_url_missing');
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.post_action_review.evidence_rejected', stepId: 'submit_reddit_post' }),
    );
  });

  it('submit_reddit_post enters HITL review when LLM success evidence disagrees with deterministic validation', async () => {
    process.env.AI_VISION_UI_PORT = '30012';
    mockHitlCoordinator.requestCompletionConfirmation.mockResolvedValueOnce({ confirmed: true });

    mockAutomationEngine.runTask.mockImplementation(async (_prompt: string, options?: { stepId?: string }) => {
      if (options?.stepId === 'check_duplicate_reddit_post') {
        currentUrl = 'https://www.reddit.com/r/test/submit';
        return { success: true, output: VALID_DUPLICATE_EVIDENCE, screenshots: [], durationMs: 5 };
      }
      if (options?.stepId === 'submit_reddit_post') {
        currentUrl = 'https://www.reddit.com/r/test/submit';
        return {
          success: true,
          output: [
            'OBSERVED_SUCCESS: true',
            'OBSERVED_SUCCESS_SIGNAL: canonical_comments_url',
            'CREATED_ID: t3_abc123',
            'CANONICAL_URL: https://www.reddit.com/r/test/comments/abc123/test-title/',
            'VISIBLE_TITLE: Different Title',
            'VISIBLE_BODY_EXCERPT: unrelated body',
            'CONFIDENCE: high',
          ].join('\n'),
          screenshots: [],
          durationMs: 5,
        };
      }
      return { success: true, output: 'ok', screenshots: [], durationMs: 5 };
    });

    const definition = {
      id: 'us043-submit-hitl-review',
      name: 'US-043 disagreement goes to HITL review',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, {
      post_title: 'Test Title',
      post_text: 'body text for reddit publish validation',
      subreddit: 'test',
    });

    expect(result.success).toBe(true);
    expect(mockHitlCoordinator.requestCompletionConfirmation).toHaveBeenCalledTimes(1);
    expect(mockHitlCoordinator.emit).toHaveBeenCalledWith(
      'phase_changed',
      expect.objectContaining({
        phase: 'hitl_qa',
        hitlAction: 'confirm_completion',
        currentStep: 'submit_reddit_post',
      }),
    );
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.post_action_review.evidence_escalated', stepId: 'submit_reddit_post' }),
    );
  });

  it('prepare_and_focus_body passes when current URL stays on the subreddit submit page', async () => {
    const definition = {
      id: 'us029-draft-pass',
      name: 'US-029 draft postcondition pass',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'prepare_and_focus_body',
          engine: 'browser-use' as const,
          prompt: 'Draft the reddit post',
          expectedUrlAfter: '/r/{{subreddit}}/submit',
          requiredOutputIncludes: ['DRAFT_TITLE_TYPED: {{post_title}}', 'DRAFT_BODY_FOCUSED: YES'],
          postconditionRequired: true,
        },
      ],
    };

    const result = await workflowEngine.run(definition, { post_title: 'Test Title', subreddit: 'test' });

    expect(result.success).toBe(true);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.browser_postcondition.passed', stepId: 'prepare_and_focus_body' }),
    );
  });

  it('prepare_and_focus_body fails when current URL leaves the subreddit submit page', async () => {
    mockAutomationEngine.runTask.mockImplementation(async (_prompt: string, options?: { stepId?: string }) => {
      if (options?.stepId === 'prepare_and_focus_body') {
        mockSessionManager.currentUrl.mockImplementation(async () => 'https://www.reddit.com/r/test/comments/abc123/test-title/');
        return {
          success: true,
          output: 'DRAFT_TITLE_TYPED: Test Title\nDRAFT_BODY_FOCUSED: YES',
          screenshots: [],
          durationMs: 5,
        };
      }
      return { success: true, output: 'ok', screenshots: [], durationMs: 5 };
    });

    const definition = {
      id: 'us029-draft-url-fail',
      name: 'US-029 draft URL fail',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'prepare_and_focus_body',
          engine: 'browser-use' as const,
          prompt: 'Draft the reddit post',
          expectedUrlAfter: '/r/{{subreddit}}/submit',
          requiredOutputIncludes: ['DRAFT_TITLE_TYPED: {{post_title}}', 'DRAFT_BODY_FOCUSED: YES'],
          postconditionRequired: true,
        },
      ],
    };

    const result = await workflowEngine.run(definition, { post_title: 'Test Title', subreddit: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('expected_url_missing');
  });

  it('requiredOutputIncludes missing marker fails postcondition', async () => {
    mockAutomationEngine.runTask.mockImplementation(async (_prompt: string, options?: { stepId?: string }) => {
      if (options?.stepId === 'prepare_and_focus_body') {
        return {
          success: true,
          output: 'DRAFT_TITLE_TYPED: Test Title',
          screenshots: [],
          durationMs: 5,
        };
      }
      return { success: true, output: 'ok', screenshots: [], durationMs: 5 };
    });

    const definition = {
      id: 'us029-required-output-fail',
      name: 'US-029 required output missing',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'prepare_and_focus_body',
          engine: 'browser-use' as const,
          prompt: 'Draft the reddit post',
          expectedUrlAfter: '/r/{{subreddit}}/submit',
          requiredOutputIncludes: ['DRAFT_TITLE_TYPED: {{post_title}}', 'DRAFT_BODY_FOCUSED: YES'],
          postconditionRequired: true,
        },
      ],
    };

    const result = await workflowEngine.run(definition, { post_title: 'Test Title', subreddit: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('required_output_missing');
  });

  it('postcondition failure prevents confirm_reddit_post_visible from running', async () => {
    mockAutomationEngine.runTask.mockImplementation(async (_prompt: string, options?: { stepId?: string }) => {
      if (options?.stepId === 'check_duplicate_reddit_post') {
        return { success: true, output: VALID_DUPLICATE_EVIDENCE, screenshots: [], durationMs: 5 };
      }
      if (options?.stepId === 'submit_reddit_post') {
        return { success: true, output: 'Post submitted successfully', screenshots: [], durationMs: 5 };
      }
      return { success: true, output: 'ok', screenshots: [], durationMs: 5 };
    });

    const definition = {
      id: 'us029-confirmation-blocked',
      name: 'US-029 postcondition blocks downstream confirmation',
      mode: 'direct' as const,
      params: {},
      steps: [
        ...DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
        {
          type: 'human_takeover' as const,
          id: 'confirm_reddit_post_visible',
          mode: 'confirm_completion' as const,
          reason: 'Confirm published reddit post',
        },
      ],
    };

    const result = await workflowEngine.run(definition, { post_title: 'Test Title', subreddit: 'test' });

    expect(result.success).toBe(false);
    expect(mockHitlCoordinator.requestCompletionConfirmation).not.toHaveBeenCalled();
  });

  it('postcondition failure telemetry is emitted', async () => {
    mockAutomationEngine.runTask.mockImplementation(async (_prompt: string, options?: { stepId?: string }) => {
      if (options?.stepId === 'check_duplicate_reddit_post') {
        return { success: true, output: VALID_DUPLICATE_EVIDENCE, screenshots: [], durationMs: 5 };
      }
      if (options?.stepId === 'submit_reddit_post') {
        return { success: true, output: 'Post submitted successfully', screenshots: [], durationMs: 5 };
      }
      return { success: true, output: 'ok', screenshots: [], durationMs: 5 };
    });

    const definition = {
      id: 'us029-telemetry-fail',
      name: 'US-029 telemetry fail',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    await workflowEngine.run(definition, { post_title: 'Test Title', subreddit: 'test' });

    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.browser_postcondition.failed', stepId: 'submit_reddit_post' }),
    );
  });
});

// ---------------------------------------------------------------------------
// US-031 / RF-013 — agent_task side-effect safety boundary
// ---------------------------------------------------------------------------

describe('workflowEngine US-031 agent_task side-effect safety gate', () => {
  beforeAll(() => {
    workflowEngine = require('./engine').workflowEngine;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AI_VISION_UI_PORT;
    mockSessionManager.start.mockResolvedValue(undefined);
    mockSessionManager.currentUrl.mockResolvedValue('https://example.test/page');
    mockSessionManager.getPage.mockResolvedValue(mockPage);
    mockSessionManager.click.mockResolvedValue(undefined);
    mockSessionManager.extractCookies.mockResolvedValue([]);
    mockSessionManager.syncActivePage.mockResolvedValue(undefined);
    mockSessionManager.close.mockResolvedValue(undefined);
    mockSessionManager.startScreenshotTimer.mockReturnValue(undefined);
    mockSessionManager.stopScreenshotTimer.mockReturnValue(undefined);
    mockHitlCoordinator.requestQaPause.mockResolvedValue(undefined);
    mockPage.evaluate.mockResolvedValue('Rendered page body');
    mockAutomationEngine.runTask.mockResolvedValue({
      success: true,
      output: 'agent ok',
      screenshots: [],
      durationMs: 5,
    });
  });

  it('blocks a login-intent agent_task before worker dispatch when no approval evidence is present', async () => {
    const definition = {
      id: 'us031-login-no-approval',
      name: 'US-031 login no approval',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'login_step',
          engine: 'browser-use' as const,
          prompt: 'Login to the site using the saved credentials',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain("blocked");
    expect(result.error).toContain("login");
    expect(mockAutomationEngine.runTask).not.toHaveBeenCalled();
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.agent_task_side_effect.blocked',
        stepId: 'login_step',
      }),
    );
  });

  it('allows a login-intent agent_task after approval evidence is recorded', async () => {
    const definition = {
      id: 'us031-login-with-approval',
      name: 'US-031 login with approval',
      mode: 'direct' as const,
      permissions: {
        require_human_approval_before: ['login_step'],
      },
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'login_step',
          engine: 'browser-use' as const,
          prompt: 'Login to the site using the saved credentials',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {});

    expect(result.success).toBe(true);
    expect(mockAutomationEngine.runTask).toHaveBeenCalledTimes(1);
    expect(mockHitlCoordinator.requestQaPause).toHaveBeenCalledTimes(1);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.agent_task_side_effect.allowed',
        stepId: 'login_step',
      }),
    );
  });

  it('classifies the exact live submit_reddit_post prompt as dominant submit intent with matched fill+submit signals', async () => {
    const definition = {
      id: 'us032-live-submit-dominance',
      name: 'US-032 live prompt dominant intent',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'live_submit_prompt_step',
          engine: 'browser-use' as const,
          prompt: LIVE_SUBMIT_REDDIT_PROMPT,
        },
      ],
    };

    const result = await workflowEngine.run(definition, {
      subreddit: 'test',
      post_title: 'Test Title',
      post_text: 'Body',
      reddit_duplicate_check_evidence: VALID_DUPLICATE_EVIDENCE,
      reddit_duplicate_check_result: 'NO_DUPLICATE_FOUND',
    });

    expect(result.success).toBe(true);
    expect(mockAutomationEngine.runTask).toHaveBeenCalledTimes(1);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.agent_task_side_effect.evaluated',
        stepId: 'live_submit_prompt_step',
        details: expect.objectContaining({
          intentKind: 'submit',
          dominantIntentSource: 'ranked_signals',
          selectedIntent: 'submit',
          matchedSignals: expect.arrayContaining(['fill', 'submit']),
        }),
      }),
    );
  });

  it('classifies submit plus fallback fill wording as submit', async () => {
    const definition = {
      id: 'us032-submit-over-fill',
      name: 'US-032 submit over fill',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'submit_mixed_prompt',
          engine: 'browser-use' as const,
          prompt:
            'If the title or body fields are empty, fill them first, then submit the post once and stop.',
        },
      ],
    };

    await workflowEngine.run(definition, {
      reddit_duplicate_check_evidence: VALID_DUPLICATE_EVIDENCE,
      reddit_duplicate_check_result: 'NO_DUPLICATE_FOUND',
    });

    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.agent_task_side_effect.evaluated',
        stepId: 'submit_mixed_prompt',
        details: expect.objectContaining({
          intentKind: 'submit',
          matchedSignals: expect.arrayContaining(['fill', 'submit']),
        }),
      }),
    );
  });

  it('classifies duplicate-check read-only prompt as read_only', async () => {
    const definition = {
      id: 'us032-read-only-duplicate-check',
      name: 'US-032 read-only duplicate check',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'duplicate_check_step',
          engine: 'browser-use' as const,
          prompt: 'Duplicate check before posting to reddit r/test. Read visible titles and summarize overlap scores.',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {});

    expect(result.success).toBe(true);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.agent_task_side_effect.evaluated',
        stepId: 'duplicate_check_step',
        details: expect.objectContaining({
          intentKind: 'read_only',
          dominantIntentSource: 'read_only_fallback',
          selectedIntent: 'read_only',
          matchedSignals: expect.arrayContaining(['read_only']),
        }),
      }),
    );
  });

  it('loads the exact live duplicate-check prompt from workflow YAML and allows it before evidence exists', async () => {
    mockAutomationEngine.runTask.mockResolvedValueOnce({
      success: true,
      output: VALID_DUPLICATE_EVIDENCE,
      screenshots: [],
      durationMs: 5,
    });

    const definition = {
      id: 'us033-live-duplicate-check',
      name: 'US-033 live duplicate-check prompt',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'check_duplicate_reddit_post',
          engine: 'browser-use' as const,
          rawPrompt: true as const,
          prompt: LIVE_CHECK_DUPLICATE_REDDIT_PROMPT,
        },
      ],
    };

    const result = await workflowEngine.run(definition, {
      subreddit: 'test',
      post_title: 'ai-vision workflow update',
    });

    expect(result.success).toBe(true);
    expect(mockAutomationEngine.runTask).toHaveBeenCalledTimes(1);
    expect(result.outputs['reddit_duplicate_check_evidence']).toContain('EXTRACTED_TITLES');
    expect(result.outputs['reddit_duplicate_check_result']).toBe('NO_DUPLICATE_FOUND');
    expect(mockAutomationEngine.runTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        stepId: 'check_duplicate_reddit_post',
      }),
    );
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.agent_task_side_effect.evaluated',
        stepId: 'check_duplicate_reddit_post',
        details: expect.objectContaining({
          intentKind: 'read_only',
          dominantIntentSource: 'evidence_producing_duplicate_check',
          selectedIntent: 'read_only',
          evidenceProducingReadOnly: true,
          evidenceContract: 'reddit_duplicate_check',
          matchedSignals: expect.arrayContaining(['read_only', 'submit']),
          suppressedProtectedSignals: expect.arrayContaining(['submit']),
        }),
      }),
    );
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.agent_task_side_effect.allowed',
        stepId: 'check_duplicate_reddit_post',
        details: expect.objectContaining({
          intentKind: 'read_only',
          decision: 'allowed_evidence_producing_read_only',
        }),
      }),
    );
  });

  it('blocks the exact live submit prompt when duplicate-check evidence is missing', async () => {
    const definition = {
      id: 'us033-live-submit-no-evidence',
      name: 'US-033 live submit prompt without evidence',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'submit_reddit_post',
          engine: 'browser-use' as const,
          prompt: LIVE_SUBMIT_REDDIT_PROMPT,
        },
      ],
    };

    const result = await workflowEngine.run(definition, {
      subreddit: 'test',
      post_title: 'ai-vision workflow update',
      post_text: 'body',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('duplicate-check evidence');
    expect(mockAutomationEngine.runTask).not.toHaveBeenCalled();
  });

  it('blocks a posting-style agent_task before worker dispatch when content output is empty', async () => {
    const definition = {
      id: 'us031-post-empty-content',
      name: 'US-031 post empty content',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'post_content_step',
          engine: 'browser-use' as const,
          prompt: 'Publish the article to the blog',
        },
      ],
    };

    // pre-generated content output is present but empty
    const result = await workflowEngine.run(definition, { reddit_post_text: '' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
    expect(result.error).toContain('reddit_post_text');
    expect(mockAutomationEngine.runTask).not.toHaveBeenCalled();
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.agent_task_side_effect.blocked',
        stepId: 'post_content_step',
      }),
    );
  });

  it('blocks a posting-style agent_task before worker dispatch when content output is invalid', async () => {
    const definition = {
      id: 'us031-post-invalid-content',
      name: 'US-031 post invalid content',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'publish_step',
          engine: 'browser-use' as const,
          prompt: 'Publish the generated content to reddit',
        },
      ],
    };

    // pre-generated content is a TODO placeholder
    const result = await workflowEngine.run(definition, { reddit_post_text: 'TODO: write something meaningful' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
    expect(result.error).toContain('reddit_post_text');
    expect(mockAutomationEngine.runTask).not.toHaveBeenCalled();
  });

  it('blocks a Reddit submit-style agent_task when duplicate-check evidence is missing', async () => {
    const definition = {
      id: 'us031-reddit-no-evidence',
      name: 'US-031 reddit no evidence',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'post_to_reddit',
          engine: 'browser-use' as const,
          prompt: 'Submit this post to the reddit subreddit by clicking the submit button',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
    expect(result.error).toContain('duplicate-check evidence');
    expect(mockAutomationEngine.runTask).not.toHaveBeenCalled();
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.agent_task_side_effect.blocked',
        stepId: 'post_to_reddit',
      }),
    );
  });

  it('blocks a Reddit submit-style agent_task when duplicate risk is present', async () => {
    const definition = {
      id: 'us031-reddit-duplicate-risk',
      name: 'US-031 reddit duplicate risk',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'post_to_reddit',
          engine: 'browser-use' as const,
          prompt: 'Submit this post to the reddit subreddit by clicking the submit button',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {
      reddit_duplicate_check_evidence: DUPLICATE_RISK_EVIDENCE,
      reddit_duplicate_check_result: 'DUPLICATE_RISK',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
    expect(result.error).toContain('duplicate risk');
    expect(mockAutomationEngine.runTask).not.toHaveBeenCalled();
  });

  it('routes a read-only agent_task normally without blocking', async () => {
    const definition = {
      id: 'us031-read-only',
      name: 'US-031 read-only routes normally',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'check_page_step',
          engine: 'browser-use' as const,
          prompt: 'Check the current page status and summarize the results',
        },
      ],
    };

    const result = await workflowEngine.run(definition, {});

    expect(result.success).toBe(true);
    expect(mockAutomationEngine.runTask).toHaveBeenCalledTimes(1);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.agent_task_side_effect.allowed',
        stepId: 'check_page_step',
      }),
    );
  });

  it('still applies browser postcondition validation after a protected agent_task executes', async () => {
    let currentUrl = 'https://www.reddit.com/r/test/submit';
    mockSessionManager.currentUrl.mockImplementation(async () => currentUrl);

    mockAutomationEngine.runTask.mockImplementation(async (_prompt: string, options?: { stepId?: string }) => {
      if (options?.stepId === 'check_duplicate_reddit_post') {
        return { success: true, output: VALID_DUPLICATE_EVIDENCE, screenshots: [], durationMs: 5 };
      }
      if (options?.stepId === 'submit_reddit_post') {
        currentUrl = 'https://www.reddit.com/r/test/comments/abc123/test-title/';
        return {
          success: true,
          output: 'Final URL: https://www.reddit.com/r/test/comments/abc123/test-title/',
          screenshots: [],
          durationMs: 5,
        };
      }
      return { success: true, output: 'ok', screenshots: [], durationMs: 5 };
    });

    const definition = {
      id: 'us031-postcondition',
      name: 'US-031 postcondition still runs',
      mode: 'direct' as const,
      params: {},
      steps: DUPLICATE_CHECK_THEN_SUBMIT_STEPS,
    };

    const result = await workflowEngine.run(definition, { post_title: 'Test Title', subreddit: 'test' });

    expect(result.success).toBe(true);
    // postcondition gate ran after submit
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.browser_postcondition.passed', stepId: 'submit_reddit_post' }),
    );
    // safety gate also ran
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'workflow.agent_task_side_effect.evaluated', stepId: 'submit_reddit_post' }),
    );
  });

  it('emits blocked telemetry with intent details when safety gate blocks dispatch', async () => {
    const definition = {
      id: 'us031-blocked-telemetry',
      name: 'US-031 blocked telemetry',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'auth_step',
          engine: 'browser-use' as const,
          prompt: 'Sign in to the portal with stored credentials',
        },
      ],
    };

    await workflowEngine.run(definition, {});

    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.agent_task_side_effect.blocked',
        stepId: 'auth_step',
        details: expect.objectContaining({
          intentKind: 'login',
          check: 'approval',
        }),
      }),
    );
  });

  it('emits allowed telemetry with intent details when safety gate permits dispatch', async () => {
    const definition = {
      id: 'us031-allowed-telemetry',
      name: 'US-031 allowed telemetry',
      mode: 'direct' as const,
      params: {},
      steps: [
        {
          type: 'agent_task' as const,
          id: 'scan_step',
          engine: 'browser-use' as const,
          prompt: 'Scan and extract all available data from the page',
        },
      ],
    };

    await workflowEngine.run(definition, {});

    expect(mockAutomationEngine.runTask).toHaveBeenCalledTimes(1);
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.agent_task_side_effect.allowed',
        stepId: 'scan_step',
        details: expect.objectContaining({
          intentKind: 'read_only',
        }),
      }),
    );
    expect(mockTelemetry.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workflow.agent_task_side_effect.evaluated',
        stepId: 'scan_step',
        details: expect.objectContaining({
          intentKind: 'read_only',
          matchedSignals: expect.arrayContaining(['read_only']),
        }),
      }),
    );
  });
});
