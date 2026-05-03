import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionManager } from './manager';
import { telemetry } from '../telemetry';
import type { SessionState } from './types';
import { runStartupScreenshotScavenger } from './screenshot-retention';
import { SessionRepository } from '../db/repository';

jest.mock('../telemetry', () => ({
  telemetry: {
    emit: jest.fn(),
  },
}));

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: 'sess-test',
    phase: 'running',
    startedAt: new Date('2026-05-02T00:00:00.000Z'),
    lastUpdatedAt: new Date('2026-05-02T00:00:01.000Z'),
    currentStep: 'step-a',
    ...overrides,
  };
}

describe('SessionManager screenshot policy', () => {
  let sessionDir: string;
  let manager: SessionManager;
  let originalSessionDir: string | undefined;
  let originalDbPath: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    originalSessionDir = process.env.SESSION_DIR;
    originalDbPath = process.env.DB_PATH;
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-vision-shot-'));
    process.env.SESSION_DIR = sessionDir;
    process.env.DB_PATH = path.join(sessionDir, 'test.sqlite');
    manager = new SessionManager();
    (manager as unknown as { _started: boolean })._started = true;
  });

  afterEach(() => {
    if (originalSessionDir === undefined) {
      delete process.env.SESSION_DIR;
    } else {
      process.env.SESSION_DIR = originalSessionDir;
    }
    if (originalDbPath === undefined) {
      delete process.env.DB_PATH;
    } else {
      process.env.DB_PATH = originalDbPath;
    }
    fs.rmSync(sessionDir, { recursive: true, force: true });
  });

  it('blocks pii_wait screenshots with structured next action and no pixels', async () => {
    const page = {
      url: jest.fn(() => 'https://example.test/account'),
      screenshot: jest.fn(),
      locator: jest.fn(),
    };
    jest.spyOn(manager, 'getPage').mockResolvedValue(page as never);
    jest.spyOn(manager, 'currentUrl').mockResolvedValue('https://example.test/account');

    const payload = await manager.captureScreenshot({
      source: 'mcp',
      accessPath: 'mcp',
      state: makeState({ phase: 'pii_wait' }),
    });

    expect(payload.base64).toBeUndefined();
    expect(payload.class).toBe('sensitive_blocked');
    expect(payload.blockedReason).toBe('pii_wait_active');
    expect(payload.nextAction).toBe('retry_after_sensitive_phase');
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it('redacts selector-based sensitive screenshots and deletes step-scoped temp files on step advance', async () => {
    const firstLocator = {};
    const page = {
      url: jest.fn(() => 'https://example.test/form'),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('masked-bytes')),
      locator: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(1),
        first: jest.fn(() => firstLocator),
      }),
    };
    jest.spyOn(manager, 'getPage').mockResolvedValue(page as never);
    jest.spyOn(manager, 'currentUrl').mockResolvedValue('https://example.test/form');
    manager.setSensitiveScreenshotContext({
      stepId: 'step-a',
      selectors: ['#ssn'],
      labels: ['SSN'],
    });

    const payload = await manager.captureScreenshot({
      source: 'session_manager',
      accessPath: 'ui',
      state: makeState({ currentStep: 'step-a' }),
    });

    expect(payload.class).toBe('step_scoped');
    expect(payload.redactionApplied).toBe(true);
    expect(payload.base64).toBe(Buffer.from('masked-bytes').toString('base64'));
    expect(payload.path).toBeDefined();
    expect(payload.path && fs.existsSync(payload.path)).toBe(true);
    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({
      mask: [firstLocator],
      maskColor: '#000000',
    }));

    manager.handleStepAdvance('step-b');

    expect(payload.path && fs.existsSync(payload.path)).toBe(false);

    for (const [event] of (telemetry.emit as jest.Mock).mock.calls) {
      expect(JSON.stringify(event.details ?? {})).not.toContain(payload.base64 ?? '');
    }
  });

  it('records pending and verified deletion audit rows before broadcasting evidence invalidation', () => {
    const evidencePath = path.join(sessionDir, 'evidence.jpg');
    fs.writeFileSync(evidencePath, Buffer.from('evidence-bytes'));
    const deletedEvents: unknown[] = [];
    manager.on('screenshot_deleted', event => deletedEvents.push(event));

    const result = manager.deleteEvidenceScreenshot({
      evidenceId: 'ev-delete',
      sessionId: 'sess-test',
      workflowId: 'wf-test',
      stepId: 'capture',
      screenshotPath: evidencePath,
      actor: 'test',
      reason: 'test cleanup',
    });

    expect(result.deleted).toBe(true);
    expect(fs.existsSync(evidencePath)).toBe(false);
    expect(deletedEvents).toHaveLength(1);

    const repo = new SessionRepository(process.env.DB_PATH);
    const audit = repo.listScreenshotEvidenceAudit('ev-delete');
    expect(audit.map(row => row.action)).toEqual(['pending_deletion', 'deleted']);
    expect(audit[0].contentHash).toBe(result.contentHash);
  });

  it('startup scavenger deletes only ttl-eligible rolling frames in bounded batches', () => {
    const rollingDir = path.join(sessionDir, 'rolling');
    fs.mkdirSync(rollingDir, { recursive: true });
    const oldFrame = path.join(rollingDir, 'frame-old.jpg');
    const freshFrame = path.join(rollingDir, 'frame-fresh.jpg');
    fs.writeFileSync(oldFrame, Buffer.from('old'));
    fs.writeFileSync(freshFrame, Buffer.from('fresh'));
    const now = Date.now();
    fs.utimesSync(oldFrame, new Date(now - 26 * 60 * 60 * 1000), new Date(now - 26 * 60 * 60 * 1000));

    const summary = runStartupScreenshotScavenger({
      repo: new SessionRepository(process.env.DB_PATH),
      nowMs: now,
      limit: 1,
      rootDir: rollingDir,
    });

    expect(summary.scannedCount).toBe(1);
    expect(summary.deletedCount).toBe(1);
    expect(fs.existsSync(oldFrame)).toBe(false);
    expect(fs.existsSync(freshFrame)).toBe(true);
  });
});
