import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { telemetry } from '../telemetry';
import type { WorkflowScreenshotRecord } from '../workflow/types';
import { SessionRepository } from '../db/repository';

export type EvidenceAuditAction =
  | 'reviewed'
  | 'retained'
  | 'pending_deletion'
  | 'deleted'
  | 'delete_failed'
  | 'rejected'
  | 'exported';

export interface EvidenceAuditRecord {
  evidenceId: string;
  sessionId: string;
  workflowId?: string;
  stepId?: string;
  action: EvidenceAuditAction;
  actor: string;
  reason?: string;
  screenshotPath: string;
  contentHash: string;
}

export interface CleanupFailureRecord {
  screenshotPath: string;
  sessionId?: string;
  workflowId?: string;
  stepId?: string;
  class?: string;
  retention?: string;
  action: string;
  error: string;
}

export interface CleanupSummary {
  scannedCount: number;
  deletedCount: number;
  failedCount: number;
  skippedCount: number;
  deletedFiles: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_LIMIT = 100;

export function sessionRoot(): string {
  return process.env.SESSION_DIR ?? path.join(process.cwd(), 'sessions');
}

export function rollingScreenshotDir(): string {
  return path.join(sessionRoot(), 'rolling');
}

export function workflowScreenshotDir(): string {
  return path.join(sessionRoot(), 'workflow');
}

export function debugScreenshotRetentionEnabled(): boolean {
  return process.env.AI_VISION_RETAIN_DEBUG_SCREENSHOTS === 'true';
}

export function generateEvidenceId(sessionId: string, stepId: string, screenshotPath: string): string {
  const seed = `${sessionId}:${stepId}:${screenshotPath}:${Date.now()}:${crypto.randomUUID()}`;
  return `ev-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}

export function contentHashForBuffer(buffer: Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

export function contentHashForFile(screenshotPath: string): string {
  return contentHashForBuffer(fs.readFileSync(screenshotPath));
}

export function ttlEligibleAt(
  signals: { sessionEndedAt?: string; capturedAt?: string; fileMtimeMs?: number },
  ttlMs = DAY_MS,
): number {
  const sessionEnded = signals.sessionEndedAt ? Date.parse(signals.sessionEndedAt) : NaN;
  if (Number.isFinite(sessionEnded)) return sessionEnded + ttlMs;

  const captured = signals.capturedAt ? Date.parse(signals.capturedAt) : NaN;
  if (Number.isFinite(captured)) return captured + ttlMs;

  return (signals.fileMtimeMs ?? 0) + ttlMs;
}

export function auditEvidenceScreenshots(input: {
  repo: SessionRepository;
  sessionId: string;
  workflowId: string;
  screenshots: WorkflowScreenshotRecord[];
  actor?: string;
}): void {
  for (const screenshot of input.screenshots) {
    if (screenshot.class !== 'evidence') continue;
    const evidenceId = screenshot.evidenceId ?? generateEvidenceId(input.sessionId, screenshot.stepId, screenshot.path);
    let contentHash = screenshot.contentHash;
    if (!contentHash && fs.existsSync(screenshot.path)) {
      contentHash = contentHashForFile(screenshot.path);
      screenshot.contentHash = contentHash;
    }
    screenshot.evidenceId = evidenceId;
    if (!contentHash) continue;

    input.repo.saveScreenshotEvidenceAudit({
      evidenceId,
      sessionId: input.sessionId,
      workflowId: input.workflowId,
      stepId: screenshot.stepId,
      action: 'retained',
      actor: input.actor ?? 'wrapup',
      reason: 'Evidence screenshot retained for manual review/audit.',
      screenshotPath: screenshot.path,
      contentHash,
    });
  }
}

export function deleteScreenshotFile(input: {
  repo?: SessionRepository;
  screenshotPath: string;
  sessionId?: string;
  workflowId?: string;
  stepId?: string;
  class?: string;
  retention?: string;
  action: string;
}): boolean {
  try {
    if (fs.existsSync(input.screenshotPath)) {
      fs.unlinkSync(input.screenshotPath);
    }
    return !fs.existsSync(input.screenshotPath);
  } catch (error) {
    input.repo?.saveScreenshotCleanupFailure({
      screenshotPath: input.screenshotPath,
      sessionId: input.sessionId,
      workflowId: input.workflowId,
      stepId: input.stepId,
      class: input.class,
      retention: input.retention,
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function cleanupWorkflowScreenshotsOnWrapUp(input: {
  repo: SessionRepository;
  sessionId: string;
  workflowId: string;
  success: boolean;
  screenshots: WorkflowScreenshotRecord[];
}): CleanupSummary {
  const summary: CleanupSummary = {
    scannedCount: 0,
    deletedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    deletedFiles: [],
  };

  for (const screenshot of input.screenshots) {
    summary.scannedCount += 1;
    if (screenshot.class === 'evidence' || screenshot.retention === 'keep_until_manual_review') {
      summary.skippedCount += 1;
      continue;
    }

    const deleteOnSuccess = input.success && screenshot.retention === 'delete_on_success';
    const ttlDebug = screenshot.retention === 'ttl_24h' && !debugScreenshotRetentionEnabled() && isTtlEligible(screenshot);
    if (!deleteOnSuccess && !ttlDebug) {
      summary.skippedCount += 1;
      continue;
    }

    const deleted = deleteScreenshotFile({
      repo: input.repo,
      screenshotPath: screenshot.path,
      sessionId: input.sessionId,
      workflowId: input.workflowId,
      stepId: screenshot.stepId,
      class: screenshot.class,
      retention: screenshot.retention,
      action: 'wrapup_cleanup',
    });
    if (deleted) {
      summary.deletedCount += 1;
      summary.deletedFiles.push(screenshot.path);
    } else {
      summary.failedCount += 1;
    }
  }

  emitCleanupTelemetry('session.screenshot.wrapup_cleanup', input.sessionId, input.workflowId, summary);
  return summary;
}

function isTtlEligible(screenshot: WorkflowScreenshotRecord, nowMs = Date.now()): boolean {
  const fileMtimeMs = fs.existsSync(screenshot.path) ? fs.statSync(screenshot.path).mtimeMs : undefined;
  return ttlEligibleAt({
    capturedAt: screenshot.takenAt,
    fileMtimeMs,
  }) <= nowMs;
}

export function runStartupScreenshotScavenger(input: {
  repo?: SessionRepository;
  nowMs?: number;
  limit?: number;
  rootDir?: string;
} = {}): CleanupSummary {
  const repo = input.repo ?? new SessionRepository();
  const nowMs = input.nowMs ?? Date.now();
  const limit = input.limit ?? DEFAULT_BATCH_LIMIT;
  const rootDir = input.rootDir ?? rollingScreenshotDir();
  const summary: CleanupSummary = {
    scannedCount: 0,
    deletedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    deletedFiles: [],
  };

  if (!fs.existsSync(rootDir)) return summary;
  const entries = fs
    .readdirSync(rootDir)
    .filter(file => file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png'))
    .sort((a, b) => fs.statSync(path.join(rootDir, a)).mtimeMs - fs.statSync(path.join(rootDir, b)).mtimeMs)
    .slice(0, limit);

  for (const entry of entries) {
    const screenshotPath = path.join(rootDir, entry);
    summary.scannedCount += 1;
    const stat = fs.statSync(screenshotPath);
    const eligibleAt = ttlEligibleAt({ fileMtimeMs: stat.mtimeMs });
    if (eligibleAt > nowMs) {
      summary.skippedCount += 1;
      continue;
    }
    const deleted = deleteScreenshotFile({
      repo,
      screenshotPath,
      class: 'debug_frame',
      retention: 'ttl_24h',
      action: 'startup_scavenger',
    });
    if (deleted) {
      summary.deletedCount += 1;
      summary.deletedFiles.push(screenshotPath);
    } else {
      summary.failedCount += 1;
    }
  }

  emitCleanupTelemetry('session.screenshot.startup_scavenger', undefined, undefined, summary);
  return summary;
}

export function deleteEvidenceScreenshot(input: {
  repo: SessionRepository;
  evidenceId: string;
  sessionId: string;
  workflowId?: string;
  stepId?: string;
  screenshotPath: string;
  contentHash?: string;
  actor: string;
  reason: string;
}): { deleted: boolean; contentHash: string } {
  const contentHash = input.contentHash ?? (fs.existsSync(input.screenshotPath) ? contentHashForFile(input.screenshotPath) : 'sha256:missing');
  input.repo.saveScreenshotEvidenceAudit({
    ...input,
    action: 'pending_deletion',
    contentHash,
  });

  const deleted = deleteScreenshotFile({
    repo: input.repo,
    screenshotPath: input.screenshotPath,
    sessionId: input.sessionId,
    workflowId: input.workflowId,
    stepId: input.stepId,
    class: 'evidence',
    retention: 'keep_until_manual_review',
    action: 'evidence_delete',
  });

  input.repo.saveScreenshotEvidenceAudit({
    ...input,
    action: deleted ? 'deleted' : 'delete_failed',
    contentHash,
  });

  return { deleted, contentHash };
}

function emitCleanupTelemetry(
  name: string,
  sessionId: string | undefined,
  workflowId: string | undefined,
  summary: CleanupSummary,
): void {
  telemetry.emit({
    source: 'session',
    name,
    sessionId,
    workflowId,
    details: {
      scannedCount: summary.scannedCount,
      deletedCount: summary.deletedCount,
      failedCount: summary.failedCount,
      skippedCount: summary.skippedCount,
      deletedFiles: summary.deletedFiles,
    },
  });
}
