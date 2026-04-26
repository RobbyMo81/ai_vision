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
  type: jest.fn(),
  startScreenshotTimer: jest.fn(),
  stopScreenshotTimer: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

const mockTelemetry = {
  emit: jest.fn(),
};

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

jest.mock('../content/gemini-writer', () => ({
  getGeminiWriter: () => mockWriter,
}));

jest.mock('../telemetry', () => ({
  telemetry: mockTelemetry,
}));

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
    mockWriter.writePost.mockReset();
    delete process.env.AI_VISION_UI_PORT;
    mockSessionManager.start.mockResolvedValue(undefined);
    mockSessionManager.currentUrl.mockResolvedValue('https://example.test/page');
    mockSessionManager.navigate.mockRejectedValue(new Error('unexpected fallback step executed'));
    mockSessionManager.getPage.mockResolvedValue(mockPage);
    mockSessionManager.close.mockResolvedValue(undefined);
    mockSessionManager.startScreenshotTimer.mockReturnValue(undefined);
    mockSessionManager.stopScreenshotTimer.mockReturnValue(undefined);
    mockPage.evaluate.mockResolvedValue('Rendered page body');
    mockWriter.writePost.mockResolvedValue({
      text: 'Generated post body',
      platform: 'x',
      model: 'gemini-test',
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
