export type TelemetryLevel = 'debug' | 'info' | 'warn' | 'error';
export type TelemetrySource =
  | 'workflow'
  | 'session'
  | 'hitl'
  | 'ui'
  | 'wrapup'
  | 'db'
  | 'engine'
  | 'webhook'
  | 'orchestrator';

export interface TelemetryIssue {
  code: string;
  severity: 'warn' | 'error';
  message: string;
}

export interface TelemetryEvent {
  id: string;
  name: string;
  level: TelemetryLevel;
  source: TelemetrySource;
  sessionId?: string;
  workflowId?: string;
  stepId?: string;
  durationMs?: number;
  details: Record<string, unknown>;
  createdAt: string;
  issue?: TelemetryIssue;
}

export interface TelemetryEventInput {
  name: string;
  level?: TelemetryLevel;
  source: TelemetrySource;
  sessionId?: string;
  workflowId?: string;
  stepId?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}
