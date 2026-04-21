let workflowEngine: import('./engine').WorkflowEngine;

const mockWriter = {
  writePost: jest.fn(),
};

const mockPage = {
  evaluate: jest.fn(),
};

const mockSessionManager = {
  start: jest.fn(),
  currentUrl: jest.fn(),
  getPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

const mockHitlCoordinator = {
  setPhase: jest.fn(),
  emit: jest.fn(),
  requestQaPause: jest.fn(),
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
    delete process.env.AI_VISION_UI_PORT;
    mockSessionManager.start.mockResolvedValue(undefined);
    mockSessionManager.currentUrl.mockResolvedValue('https://example.test/page');
    mockPage.evaluate.mockResolvedValue('Rendered page body');
    mockSessionManager.getPage.mockResolvedValue(mockPage);
    mockWriter.writePost.mockResolvedValue({
      text: 'Generated post body',
      platform: 'x',
      model: 'gemini-test',
    });
  });

  it('resolves downstream placeholders from same-run outputs', async () => {
    const definition = {
      id: 'rf001-test',
      name: 'RF-001 runtime substitution test',
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
          type: 'extract' as const,
          id: 'inspect_generated_text',
          instruction: 'Verify generated text: {{x_post_text}}',
          outputKey: 'inspection',
        },
      ],
    };

    const result = await workflowEngine.run(definition);

    expect(result.success).toBe(true);
    expect(result.outputs.x_post_text).toBe('Generated post body');
    expect(result.outputs.inspection).toContain('[Extract instruction: Verify generated text: Generated post body]');
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
      params: {},
      steps: [],
    };

    const result = await workflowEngine.run(definition, { topic: 'test' }, 'sess-001');

    expect(mockRunOrchestratorLoop).toHaveBeenCalledTimes(1);
    expect(mockRunOrchestratorLoop).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'yaml-test', source: 'yaml' }),
      expect.objectContaining({ topic: 'test' }),
      'sess-001',
    );
    expect(result.success).toBe(true);
    expect(result.outputs.result).toBe('done');
  });

  it('does not delegate to orchestrator loop for builtin workflows', async () => {
    const definition = {
      id: 'builtin-test',
      name: 'Builtin Test',
      source: 'builtin' as const,
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
