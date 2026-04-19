import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { SessionRepository } from '../db/repository';
import { TelemetryEvent, TelemetryEventInput, TelemetryIssue } from './types';

function memoryDir(): string {
  return (
    process.env.AI_VISION_MEMORY_DIR ??
    path.join(process.env.HOME ?? process.cwd(), '.ai-vision', 'memory')
  );
}

function telemetryDir(): string {
  return path.join(memoryDir(), 'telemetry');
}

function telemetryEventsFile(): string {
  return path.join(telemetryDir(), 'events.ndjson');
}

function ensureDir(): void {
  fs.mkdirSync(telemetryDir(), { recursive: true });
}

function redactDetails(details: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    const lowered = key.toLowerCase();
    if (
      lowered.includes('password') ||
      lowered.includes('secret') ||
      lowered.includes('token') ||
      lowered.includes('value') ||
      lowered.includes('ssn') ||
      lowered.includes('dob')
    ) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export class TelemetryManager {
  private repo: SessionRepository | null = null;

  private getRepo(): SessionRepository {
    this.repo ??= new SessionRepository();
    return this.repo;
  }

  private detectIssue(event: TelemetryEvent): TelemetryIssue | undefined {
    if (event.level === 'error') {
      return {
        code: 'error-event',
        severity: 'error',
        message: `Error event emitted: ${event.name}`,
      };
    }

    if (event.name === 'workflow.step.failed') {
      return {
        code: 'step-failed',
        severity: 'error',
        message: `Workflow step failed${event.stepId ? `: ${event.stepId}` : ''}`,
      };
    }

    if (event.name === 'session.browser.exited') {
      return {
        code: 'browser-exited',
        severity: 'error',
        message: 'Browser exited unexpectedly during an active session.',
      };
    }

    if (event.name === 'hitl.wait.completed' && (event.durationMs ?? 0) > 120_000) {
      return {
        code: 'hitl-wait-long',
        severity: 'warn',
        message: `HITL wait exceeded 120s (${event.durationMs}ms).`,
      };
    }

    if (event.name === 'ui.screenshot.failed') {
      return {
        code: 'ui-screenshot-failed',
        severity: 'warn',
        message: 'UI screenshot fetch failed.',
      };
    }

    if (event.name === 'ui.state.sync.missing') {
      return {
        code: 'ui-state-sync-missing',
        severity: 'warn',
        message: 'HITL UI loaded without an active state sync snapshot.',
      };
    }

    return undefined;
  }

  emit(input: TelemetryEventInput): TelemetryEvent {
    ensureDir();

    const event: TelemetryEvent = {
      id: crypto.randomUUID(),
      name: input.name,
      level: input.level ?? 'info',
      source: input.source,
      sessionId: input.sessionId,
      workflowId: input.workflowId,
      stepId: input.stepId,
      durationMs: input.durationMs,
      details: redactDetails(input.details ?? {}),
      createdAt: new Date().toISOString(),
    };

    const issue = this.detectIssue(event);
    if (issue) event.issue = issue;

    fs.appendFileSync(telemetryEventsFile(), `${JSON.stringify(event)}\n`, 'utf8');
    this.getRepo().saveTelemetryEvent(event);
    return event;
  }

  recent(limit = 50): TelemetryEvent[] {
    return this.getRepo().listTelemetry(limit);
  }

  recentAlerts(limit = 20): TelemetryEvent[] {
    return this.getRepo().listTelemetryAlerts(limit);
  }
}

export const telemetry = new TelemetryManager();
