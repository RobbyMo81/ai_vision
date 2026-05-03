import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sanitizeWorkflowResultForPersistence, WorkflowDefinition, WorkflowResult } from './types';

const mockTaskMetadata = {
  upsert: jest.fn(),
};

const mockForgeSicStore = {
  saveSicTrigger: jest.fn(() => true),
};

const mockLongTermMemory = {
  writeStory: jest.fn(),
  getAllImprovements: jest.fn(() => []),
};

const mockShortTermMemory = {
  setScratchDodDraft: jest.fn(),
  addScratchNote: jest.fn(),
  getSession: jest.fn(() => null),
  getTotalAgentSteps: jest.fn(() => 0),
  getAllCompletedFields: jest.fn(() => []),
  getAllNotes: jest.fn(() => []),
  clearSensitiveData: jest.fn(),
  reset: jest.fn(),
};

const mockTelemetry = {
  emit: jest.fn(),
};

jest.mock('../memory/metadata', () => ({
  taskMetadata: mockTaskMetadata,
}));

jest.mock('../memory', () => ({
  forgeSicStore: mockForgeSicStore,
  longTermMemory: mockLongTermMemory,
  shortTermMemory: mockShortTermMemory,
}));

jest.mock('../telemetry', () => ({
  telemetry: mockTelemetry,
}));

describe('wrap-up screenshot persistence sanitization', () => {
  const originalMemoryDir = process.env.AI_VISION_MEMORY_DIR;
  const originalDbPath = process.env.DB_PATH;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.AI_VISION_MEMORY_DIR = originalMemoryDir;
    process.env.DB_PATH = originalDbPath;
  });

  it('clones workflow results for persistence without mutating runtime screenshot bytes', () => {
    const runtimeResult: WorkflowResult = {
      workflowId: 'wf-sanitize',
      success: true,
      stepResults: [
        {
          stepId: 'capture_evidence',
          success: true,
          durationMs: 5,
          screenshotPath: '/tmp/evidence.jpg',
          screenshotBase64: 'runtime-step-base64',
        },
      ],
      outputs: {},
      screenshots: [
        {
          path: '/tmp/evidence.jpg',
          base64: 'runtime-artifact-base64',
          stepId: 'capture_evidence',
          source: 'workflow_step',
          class: 'evidence',
          mimeType: 'image/jpeg',
          sensitivity: 'unknown',
          retention: 'keep_until_manual_review',
          persistBase64: false,
        },
      ],
      durationMs: 42,
    };

    const sanitized = sanitizeWorkflowResultForPersistence(runtimeResult);

    expect(runtimeResult.stepResults[0].screenshotBase64).toBe('runtime-step-base64');
    expect(runtimeResult.screenshots[0].base64).toBe('runtime-artifact-base64');
    expect(sanitized.stepResults[0]).not.toHaveProperty('screenshotBase64');
    expect(sanitized.screenshots[0]).toEqual({
      path: '/tmp/evidence.jpg',
      stepId: 'capture_evidence',
      source: 'workflow_step',
      class: 'evidence',
      mimeType: 'image/jpeg',
      sensitivity: 'unknown',
      retention: 'keep_until_manual_review',
      persistBase64: false,
    });
  });

  it('omits screenshot base64 from workflow_runs.result_json and wrap-up artifact JSON', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-vision-wrapup-'));
    process.env.AI_VISION_MEMORY_DIR = path.join(tempRoot, 'memory');
    process.env.DB_PATH = path.join(tempRoot, 'workflow.sqlite');

    const { wrapUpWorkflowRun } = await import('./wrap-up');
    const definition: WorkflowDefinition = {
      id: 'wf-sanitize',
      name: 'Workflow sanitize test',
      steps: [
        {
          type: 'screenshot',
          id: 'capture_evidence',
        },
      ],
    };

    const runtimeResult: WorkflowResult = {
      workflowId: definition.id,
      success: true,
      stepResults: [
        {
          stepId: 'capture_evidence',
          success: true,
          durationMs: 5,
          screenshotPath: '/tmp/evidence.jpg',
          screenshotBase64: 'runtime-step-base64',
        },
      ],
      outputs: {},
      screenshots: [
        {
          path: '/tmp/evidence.jpg',
          base64: 'runtime-artifact-base64',
          stepId: 'capture_evidence',
          source: 'workflow_step',
          class: 'evidence',
          mimeType: 'image/jpeg',
          sensitivity: 'unknown',
          retention: 'keep_until_manual_review',
          persistBase64: false,
        },
      ],
      durationMs: 42,
    };

    await wrapUpWorkflowRun({
      definition,
      sessionId: 'sess-sanitize',
      startedAt: Date.now() - 100,
      result: runtimeResult,
      finalState: null,
    });

    expect(runtimeResult.stepResults[0].screenshotBase64).toBe('runtime-step-base64');
    expect(runtimeResult.screenshots[0].base64).toBe('runtime-artifact-base64');

    const artifactPath = path.join(process.env.AI_VISION_MEMORY_DIR!, 'wrap-ups', 'sess-sanitize.json');
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as {
      result: WorkflowResult;
    };

    expect(artifact.result.stepResults[0]).not.toHaveProperty('screenshotBase64');
    expect(artifact.result.screenshots[0]).toMatchObject({
      path: '/tmp/evidence.jpg',
      stepId: 'capture_evidence',
      source: 'workflow_step',
      class: 'evidence',
      mimeType: 'image/jpeg',
      sensitivity: 'unknown',
      retention: 'keep_until_manual_review',
      persistBase64: false,
    });
    expect(artifact.result.screenshots[0].evidenceId).toMatch(/^ev-/);

    const db = new DatabaseSync(process.env.DB_PATH!);
    const row = db.prepare('SELECT result_json FROM workflow_runs WHERE session_id = ?').get('sess-sanitize') as {
      result_json: string;
    };
    const persisted = JSON.parse(row.result_json) as WorkflowResult;

    expect(persisted.stepResults[0]).not.toHaveProperty('screenshotBase64');
    expect(persisted.screenshots[0]).toMatchObject({
      path: '/tmp/evidence.jpg',
      stepId: 'capture_evidence',
      source: 'workflow_step',
      class: 'evidence',
      mimeType: 'image/jpeg',
      sensitivity: 'unknown',
      retention: 'keep_until_manual_review',
      persistBase64: false,
    });
    expect(persisted.screenshots[0].evidenceId).toMatch(/^ev-/);
  });

  it('audits retained evidence and deletes non-evidence screenshots during successful wrap-up', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-vision-wrapup-retention-'));
    process.env.AI_VISION_MEMORY_DIR = path.join(tempRoot, 'memory');
    process.env.DB_PATH = path.join(tempRoot, 'workflow.sqlite');

    const evidencePath = path.join(tempRoot, 'evidence.jpg');
    const debugPath = path.join(tempRoot, 'debug.jpg');
    const ttlPath = path.join(tempRoot, 'ttl-debug.jpg');
    fs.writeFileSync(evidencePath, Buffer.from('evidence-bytes'));
    fs.writeFileSync(debugPath, Buffer.from('debug-bytes'));
    fs.writeFileSync(ttlPath, Buffer.from('ttl-debug-bytes'));

    const { wrapUpWorkflowRun } = await import('./wrap-up');
    const definition: WorkflowDefinition = {
      id: 'wf-retention',
      name: 'Workflow retention test',
      steps: [
        { type: 'screenshot', id: 'capture_evidence' },
      ],
    };

    const runtimeResult: WorkflowResult = {
      workflowId: definition.id,
      success: true,
      stepResults: [],
      outputs: {},
      screenshots: [
        {
          path: evidencePath,
          stepId: 'capture_evidence',
          evidenceId: 'ev-test',
          source: 'workflow_step',
          class: 'evidence',
          mimeType: 'image/jpeg',
          sensitivity: 'safe',
          retention: 'keep_until_manual_review',
          persistBase64: false,
        },
        {
          path: debugPath,
          stepId: 'debug_frame',
          source: 'rolling',
          class: 'debug_frame',
          mimeType: 'image/jpeg',
          sensitivity: 'unknown',
          retention: 'delete_on_success',
          persistBase64: false,
        },
        {
          path: ttlPath,
          stepId: 'ttl_debug_frame',
          source: 'rolling',
          class: 'debug_frame',
          mimeType: 'image/jpeg',
          sensitivity: 'unknown',
          retention: 'ttl_24h',
          persistBase64: false,
          takenAt: new Date().toISOString(),
        },
      ],
      durationMs: 42,
    };

    await wrapUpWorkflowRun({
      definition,
      sessionId: 'sess-retention',
      startedAt: Date.now() - 100,
      result: runtimeResult,
      finalState: null,
    });

    expect(fs.existsSync(evidencePath)).toBe(true);
    expect(fs.existsSync(debugPath)).toBe(true);
    expect(fs.existsSync(ttlPath)).toBe(true);

    const db = new DatabaseSync(process.env.DB_PATH!);
    const auditRows = db.prepare(
      'SELECT evidence_id, action, screenshot_path, content_hash FROM screenshot_evidence_audit WHERE evidence_id = ?',
    ).all('ev-test') as Array<{
      evidence_id: string;
      action: string;
      screenshot_path: string;
      content_hash: string;
    }>;
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      evidence_id: 'ev-test',
      action: 'retained',
      screenshot_path: evidencePath,
    });
    expect(auditRows[0].content_hash).toMatch(/^sha256:/);

    const persistedRow = db.prepare('SELECT result_json FROM workflow_runs WHERE session_id = ?').get('sess-retention') as {
      result_json: string;
    };
    const persisted = JSON.parse(persistedRow.result_json) as WorkflowResult;
    expect(persisted.screenshots[0].contentHash).toBe(auditRows[0].content_hash);
    expect(JSON.stringify(persisted)).not.toContain('evidence-bytes');
  });
});
