import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { SessionManager } from './manager';
import { telemetry } from '../telemetry';
import type { SessionState } from './types';
import {
  buildRollingScreenshotFilename,
  runPostTaskScreenshotCleanupRecovery,
  runStartupScreenshotScavenger,
  schedulePostTaskScreenshotCleanup,
} from './screenshot-retention';
import { SessionRepository } from '../db/repository';

jest.mock('../telemetry', () => ({
  telemetry: {
    emit: jest.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(times = 2): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

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

  it('collapses concurrent UI live-frame requests onto one screenshot capture', async () => {
    const screenshotDeferred = deferred<Buffer>();
    const page = {
      url: jest.fn(() => 'https://example.test/live'),
      screenshot: jest.fn().mockImplementation(() => screenshotDeferred.promise),
      locator: jest.fn(),
    };
    jest.spyOn(manager, 'getPage').mockResolvedValue(page as never);
    jest.spyOn(manager, 'currentUrl').mockResolvedValue('https://example.test/live');

    const firstPromise = manager.captureScreenshot({
      source: 'session_manager',
      accessPath: 'ui',
      requestKind: 'ui_live',
      state: makeState({ currentStep: 'step-live' }),
    });
    const secondPromise = manager.captureScreenshot({
      source: 'session_manager',
      accessPath: 'ui',
      requestKind: 'ui_live',
      state: makeState({ currentStep: 'step-live' }),
    });

    await flushMicrotasks();
    expect(page.screenshot).toHaveBeenCalledTimes(1);

    screenshotDeferred.resolve(Buffer.from('live-frame'));
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.base64).toBe(Buffer.from('live-frame').toString('base64'));
    expect(second.base64).toBe(first.base64);
    expect((telemetry.emit as jest.Mock).mock.calls).toContainEqual([
      expect.objectContaining({
        name: 'session.screenshot.scheduler',
        stepId: 'step-live',
        details: expect.objectContaining({ action: 'collapsed', accessPath: 'ui' }),
      }),
    ]);
  });

  it('prioritizes workflow evidence ahead of queued rolling captures', async () => {
    const firstDeferred = deferred<Buffer>();
    const secondDeferred = deferred<Buffer>();
    const thirdDeferred = deferred<Buffer>();
    const page = {
      url: jest.fn(() => 'https://example.test/priority'),
      screenshot: jest.fn()
        .mockImplementationOnce(() => firstDeferred.promise)
        .mockImplementationOnce(() => secondDeferred.promise)
        .mockImplementationOnce(() => thirdDeferred.promise),
      locator: jest.fn(),
    };
    jest.spyOn(manager, 'getPage').mockResolvedValue(page as never);
    jest.spyOn(manager, 'currentUrl').mockResolvedValue('https://example.test/priority');

    const uiPromise = manager.captureScreenshot({
      source: 'session_manager',
      accessPath: 'ui',
      requestKind: 'ui_live',
      state: makeState({ currentStep: 'step-priority' }),
    });
    const rollingPromise = manager.captureScreenshot({
      source: 'rolling',
      accessPath: 'rolling',
      state: makeState({ currentStep: 'step-priority' }),
    });
    const evidencePromise = manager.captureScreenshot({
      source: 'workflow_step',
      accessPath: 'workflow',
      evidenceRequested: true,
      state: makeState({ currentStep: 'capture-evidence' }),
    });

    await flushMicrotasks();
    expect(page.screenshot).toHaveBeenCalledTimes(1);

    firstDeferred.resolve(Buffer.from('ui-frame'));
    await uiPromise;
    await flushMicrotasks();
    expect(page.screenshot).toHaveBeenCalledTimes(2);

    secondDeferred.resolve(Buffer.from('evidence-frame'));
    const evidence = await evidencePromise;
    expect(evidence.class).toBe('evidence');
    await flushMicrotasks();
    expect(page.screenshot).toHaveBeenCalledTimes(3);

    thirdDeferred.resolve(Buffer.from('rolling-frame'));
    const rolling = await rollingPromise;
    expect(rolling.class).toBe('debug_frame');
  });

  it('throttles rolling debug capture after a step is hung and resets on step advance', async () => {
    const page = {
      url: jest.fn(() => 'https://example.test/stuck'),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('debug-frame')),
      locator: jest.fn(),
    };
    jest.spyOn(manager, 'getPage').mockResolvedValue(page as never);
    jest.spyOn(manager, 'currentUrl').mockResolvedValue('https://example.test/stuck');
    const nowSpy = jest.spyOn(Date, 'now');

    nowSpy.mockReturnValue(0);
    manager.syncSessionState(makeState({ currentStep: 'step-a' }));

    nowSpy.mockReturnValue(1000);
    const first = await manager.captureScreenshot({
      source: 'rolling',
      accessPath: 'rolling',
      state: makeState({ currentStep: 'step-a' }),
    });
    expect(first.base64).toBeDefined();

    nowSpy.mockReturnValue(35000);
    const throttled = await manager.captureScreenshot({
      source: 'rolling',
      accessPath: 'rolling',
      state: makeState({ currentStep: 'step-a' }),
    });
    expect(throttled.base64).toBeUndefined();
    expect(page.screenshot).toHaveBeenCalledTimes(1);

    manager.handleStepAdvance('step-b');

    nowSpy.mockReturnValue(36000);
    const resumed = await manager.captureScreenshot({
      source: 'rolling',
      accessPath: 'rolling',
      state: makeState({ currentStep: 'step-b' }),
    });
    expect(resumed.base64).toBeDefined();
    expect(page.screenshot).toHaveBeenCalledTimes(2);

    expect((telemetry.emit as jest.Mock).mock.calls).toContainEqual([
      expect.objectContaining({
        name: 'session.screenshot.scheduler',
        stepId: 'step-a',
        details: expect.objectContaining({ action: 'throttled', reason: 'hung_step_guardrail' }),
      }),
    ]);

    nowSpy.mockRestore();
  });

  it('emits top-level stepId on screenshot telemetry when the active step is known', async () => {
    const page = {
      url: jest.fn(() => 'https://example.test/evidence'),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('evidence-frame')),
      locator: jest.fn(),
    };
    jest.spyOn(manager, 'getPage').mockResolvedValue(page as never);
    jest.spyOn(manager, 'currentUrl').mockResolvedValue('https://example.test/evidence');

    await manager.captureScreenshot({
      source: 'workflow_step',
      accessPath: 'workflow',
      evidenceRequested: true,
      state: makeState({ currentStep: 'capture-step' }),
    });

    expect((telemetry.emit as jest.Mock).mock.calls).toContainEqual([
      expect.objectContaining({
        name: 'session.screenshot.allowed',
        stepId: 'capture-step',
      }),
    ]);
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

  it('startup recovery deletes successful rolling frames after the 120 second ttl and preserves failed runs', async () => {
    const repo = new SessionRepository(process.env.DB_PATH);
    repo.saveWorkflowRun({
      sessionId: 'sess-success',
      workflowId: 'wf-success',
      workflowName: 'Success workflow',
      success: true,
      resultJson: JSON.stringify({ success: true, screenshots: [] }),
    });
    repo.saveWorkflowRun({
      sessionId: 'sess-failed',
      workflowId: 'wf-failed',
      workflowName: 'Failed workflow',
      success: false,
      resultJson: JSON.stringify({ success: false, screenshots: [] }),
    });

    const rollingDir = path.join(sessionDir, 'rolling');
    fs.mkdirSync(rollingDir, { recursive: true });
    const successFrame = path.join(rollingDir, buildRollingScreenshotFilename('sess-success', 1));
    const failedFrame = path.join(rollingDir, buildRollingScreenshotFilename('sess-failed', 2));
    fs.writeFileSync(successFrame, Buffer.from('success'));
    fs.writeFileSync(failedFrame, Buffer.from('failed'));

    const createdAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const db = new DatabaseSync(process.env.DB_PATH!);
    db.prepare('UPDATE workflow_runs SET created_at = ? WHERE session_id = ?').run(createdAt, 'sess-success');
    db.prepare('UPDATE workflow_runs SET created_at = ? WHERE session_id = ?').run(createdAt, 'sess-failed');

    const summary = await runPostTaskScreenshotCleanupRecovery({
      repo,
      nowMs: Date.now(),
      limit: 10,
      rollingDir,
    });

    expect(summary.deletedCount).toBe(1);
    expect(summary.deletedFiles).toContain(successFrame);
    expect(fs.existsSync(successFrame)).toBe(false);
    expect(fs.existsSync(failedFrame)).toBe(true);
  });

  it('scheduled post-task cleanup deletes rolling and debug screenshots for successful runs', async () => {
    jest.useFakeTimers();

    try {
      const repo = new SessionRepository(process.env.DB_PATH);
      repo.saveWorkflowRun({
        sessionId: 'sess-success',
        workflowId: 'wf-success',
        workflowName: 'Success workflow',
        success: true,
        resultJson: JSON.stringify({ success: true, screenshots: [] }),
      });

      const rollingDir = path.join(sessionDir, 'rolling');
      fs.mkdirSync(rollingDir, { recursive: true });
      const rollingFrame = path.join(rollingDir, buildRollingScreenshotFilename('sess-success', Date.now()));
      const debugFrame = path.join(sessionDir, 'debug-frame.jpg');
      fs.writeFileSync(rollingFrame, Buffer.from('rolling'));
      fs.writeFileSync(debugFrame, Buffer.from('debug'));

      schedulePostTaskScreenshotCleanup({
        repo,
        sessionId: 'sess-success',
        workflowId: 'wf-success',
        rollingDir,
        delayMs: 120_000,
        screenshots: [
          {
            path: debugFrame,
            stepId: 'debug-step',
            source: 'rolling',
            class: 'debug_frame',
            mimeType: 'image/jpeg',
            sensitivity: 'unknown',
            retention: 'delete_on_success',
            persistBase64: false,
          },
        ],
      });

      await jest.advanceTimersByTimeAsync(120_000);

      expect(fs.existsSync(rollingFrame)).toBe(false);
      expect(fs.existsSync(debugFrame)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
