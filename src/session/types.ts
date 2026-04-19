/**
 * Core types for session state, HITL events, and task lifecycle.
 * These are shared across the session manager, HITL coordinator,
 * workflow engine, MCP server, and UI server.
 */

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

/** Snapshot of the current session state pushed to the UI and returned by MCP tools. */
export interface SessionState {
  id: string;
  phase: TaskPhase;
  hitlAction?: 'return_control' | 'confirm_completion' | 'capture_notes' | 'secure_input';
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
}

/** Payload broadcast over WebSocket to the HITL UI. */
export interface HitlEventPayload {
  type:
    | 'takeover_requested'
    | 'control_returned'
    | 'phase_changed'
    | 'screenshot'
    | 'step_complete';
  state: SessionState;
  screenshotBase64?: string;
}
