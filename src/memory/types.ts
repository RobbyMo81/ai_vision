/**
 * Memory system types.
 *
 * SHORT-TERM: Session-scoped state accumulated across workflow steps.
 *   Injected into each agent_task prompt so the agent knows what was already
 *   completed and does not re-do work.
 *
 * LONG-TERM: Persistent story + improvement library.
 *   Stories are human-readable narrative documents written at workflow end.
 *   Improvements are categorized observations; at SIC_THRESHOLD occurrences
 *   they are promoted to SIC (Standard Improvement Contribution) status and
 *   automatically injected into every future agent_task prompt.
 */

// ---------------------------------------------------------------------------
// Short-term
// ---------------------------------------------------------------------------

export interface EncryptedValue {
  algorithm: 'aes-256-gcm';
  keyId: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  createdAt: string;
}

export interface ScratchPad {
  plan?: string;
  hypotheses: string[];
  investigations: string[];
  notes: string[];
  dodDraft?: string;
}

export interface CorrelationMatch {
  workflowId: string;
  workflowName?: string;
  domain: string;
  score: number;
  reason: string;
}

export interface PreFlightEntry {
  fieldId: string;
  label: string;
  kind: string;
  sensitivity: string;
  encryptedValue: EncryptedValue;
  updatedAt: string;
}

/** A single field that was confirmed filled by the agent in a prior step. */
export interface CompletedField {
  /** Human-readable field label (e.g. "First Name", "Departure Airport") */
  label: string;
  /** Value that was entered */
  value: string;
  /** Form section this field belongs to (e.g. "contact", "flight", "details") */
  section: string;
  /** ISO timestamp when the agent confirmed this field */
  confirmedAt: string;
}

/** Memory snapshot for one completed workflow step. */
export interface StepMemory {
  stepId: string;
  completedAt: string;
  /** One-line summary of what the step accomplished */
  summary: string;
  /** Fields confirmed filled during this step */
  completedFields: CompletedField[];
  /** URL at the end of the step */
  currentUrl: string;
  /** Absolute paths to screenshots captured during this step */
  screenshotPaths: string[];
  /** Number of internal agent micro-steps consumed */
  agentStepsUsed: number;
  /** Agent observations to carry forward (e.g. quirky form behaviour) */
  notes: string[];
}

/** Full short-term memory for one workflow execution session. */
export interface ShortTermSession {
  sessionId: string;
  workflowId: string;
  startedAt: string;
  steps: StepMemory[];
  scratchPad: ScratchPad;
  preFlight: Record<string, PreFlightEntry>;
  isBespoke: boolean;
  correlationMatches: CorrelationMatch[];
}

export interface SicTrigger {
  sessionId: string;
  workflowId: string;
  workflowName: string;
  currentUrl: string;
  triggerType?: 'qa' | 'failure';
  definitionOfDone?: string;
  hitlComments?: string;
  failureReason?: string;
  failedStepId?: string;
  selfHealInstruction?: string;
  nextStepReasoning?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Long-term
// ---------------------------------------------------------------------------

export type ImprovementCategory =
  | 'dropdown'
  | 'autocomplete'
  | 'file-upload'
  | 'navigation'
  | 'form-validation'
  | 'timing'
  | 'general';

/**
 * Number of occurrences required to promote an improvement to SIC status.
 * SIC = Standard Improvement Contribution.
 */
export const SIC_THRESHOLD = 10;

/**
 * A reusable pattern learned from agent runs.
 * Promoted to SIC when occurrences >= SIC_THRESHOLD.
 */
export interface StepImprovement {
  id: string;
  category: ImprovementCategory;
  title: string;
  /** Detailed description of the problem and solution */
  description: string;
  /**
   * Exact instruction text injected into agent prompts once promoted to SIC.
   * Should be imperative and concrete: "Always X before Y."
   */
  agentInstruction: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  /** True when occurrences >= SIC_THRESHOLD */
  isSic: boolean;
  /** Workflow IDs that contributed to this improvement */
  workflowIds: string[];
}

/** Top-level store written to improvements.json */
export interface ImprovementStore {
  improvements: StepImprovement[];
  lastUpdated: string;
}

/**
 * Narrative document written at the end of each workflow run.
 * Stored as both JSON (machine-readable) and Markdown (human-readable).
 */
export interface Story {
  id: string;
  workflowId: string;
  workflowName: string;
  sessionId: string;
  startedAt: string;
  completedAt: string;
  outcome: 'success' | 'partial' | 'failure';
  /** Narrative paragraph summarising what happened in this run */
  summary: string;
  /** Concrete lessons extracted from this run */
  lessonsLearned: string[];
  /** Improvements identified (may or may not have reached SIC threshold) */
  improvements: Array<{
    improvementId: string;
    category: ImprovementCategory;
    title: string;
    description: string;
  }>;
  metrics: {
    totalWorkflowSteps: number;
    totalAgentSteps: number;
    durationMs: number;
  };
}
