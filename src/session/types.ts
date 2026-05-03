/**
 * Core types for session state, HITL events, and task lifecycle.
 * These are shared across the session manager, HITL coordinator,
 * workflow engine, MCP server, and UI server.
 */

import type { BrowserUseActionEvent } from '../engines/python-bridge';

/** Structured outcome classification for social-publishing workflows. */
export type SocialPublishOutcome =
  | 'published'
  | 'duplicate_rejected'
  | 'rate_limited'
  | 'auth_lost'
  | 'composer_lost_draft'
  | 'unknown_publish_failure';

/** The phase a workflow session is currently in. */
export type TaskPhase =
  | 'idle'           // No task running
  | 'pre_flight'     // Correlation / planning before execution
  | 'investigation'  // Bespoke portal/DOM investigation
  | 'running'        // Workflow executing autonomously
  | 'awaiting_human' // Paused — waiting for user to return control
  | 'pii_wait'       // Waiting for secure HITL input for a sensitive field
  | 'hitl_qa'        // Waiting for HITL final-step confirmation
  | 'complete'       // Workflow finished successfully
  | 'error';         // Workflow halted with an error

export type ScreenshotSource =
  | 'session_manager'
  | 'browser_use_action'
  | 'browser_use_endpoint'
  | 'orchestrator'
  | 'workflow_step'
  | 'mcp'
  | 'rolling';

export type ScreenshotClass =
  | 'live_frame'
  | 'debug_frame'
  | 'step_scoped'
  | 'evidence'
  | 'sensitive_blocked';

export type ScreenshotMimeType = 'image/jpeg' | 'image/png';

export type ScreenshotRetention =
  | 'ephemeral'
  | 'delete_on_success'
  | 'ttl_24h'
  | 'ttl_7d'
  | 'keep_until_manual_review'
  | 'step_scoped';

export interface ScreenshotPayload {
  id: string;
  source: ScreenshotSource;
  class: ScreenshotClass;
  mimeType: ScreenshotMimeType;
  base64?: string;
  path?: string;
  takenAt: string;
  sessionId?: string;
  workflowId?: string;
  stepId?: string;
  url?: string;
  sensitivity: 'unknown' | 'safe' | 'sensitive' | 'blocked';
  retention: ScreenshotRetention;
  persistBase64: false;
  blockedReason?: string;
  nextAction?: string;
  expiresOnStepAdvance?: boolean;
  redactionApplied?: boolean;
  redactedSelectors?: string[];
}

/** Snapshot of the current session state pushed to the UI and returned by MCP tools. */
export interface SessionState {
  id: string;
  phase: TaskPhase;
  hitlAction?:
    | 'return_control'
    | 'confirm_completion'
    | 'capture_notes'
    | 'approve_draft'
    | 'secure_input'
    | 'verify_authentication'
    | 'approve_step';
  /** Name of the current workflow step being executed */
  currentStep?: string;
  stepIndex?: number;
  totalSteps?: number;
  completedSteps?: number;
  /** Human-readable reason shown to the user when awaiting_human */
  hitlReason?: string;
  /** Optional additional instructions shown in the HITL UI */
  hitlInstructions?: string;
  currentUrl?: string;
  startedAt: Date;
  lastUpdatedAt: Date;
  error?: string;

  /** Optional HITL notes payload (captured via /api/acknowledge). */
  hitlDod?: string;
  hitlComments?: string;
  hitlAckAt?: string;
  hitlFailureReason?: string;
  hitlFailureStepId?: string;
  hitlOutcomeConfirmed?: boolean;
  hitlFieldId?: string;
  hitlFieldLabel?: string;
  hitlFieldSensitivity?: string;
  correlationSummary?: string;
  isBespoke?: boolean;
  socialPublishOutcome?: SocialPublishOutcome;
}

/** Payload broadcast over WebSocket to the HITL UI. */
export interface HitlEventPayload {
  type:
    | 'takeover_requested'
    | 'control_returned'
    | 'phase_changed'
    | 'bridge_disconnected'
    | 'browser_use_action'
    | 'screenshot'
    | 'screenshot_deleted'
    | 'step_complete';
  state: SessionState;
  screenshotBase64?: string;
  screenshot?: ScreenshotPayload;
  browserUseEvent?: BrowserUseActionEvent;
  evidenceId?: string;
  screenshotPath?: string;
}
