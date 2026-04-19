/**
 * Short-term memory manager.
 *
 * Accumulates what has been accomplished across steps in a single workflow run.
 * Provides getContextPrompt() which injects a concise "what we already did"
 * block into the next agent_task prompt, preventing the agent from re-visiting
 * fields or pages it already completed.
 *
 * Screenshot paths from each step are stored here so the story writer can
 * reference them later and the UI can display per-step evidence.
 */

import { decryptText, encryptText } from '../utils/crypto';
import {
  CompletedField,
  CorrelationMatch,
  PreFlightEntry,
  ScratchPad,
  ShortTermSession,
  StepMemory,
} from './types';

// ---------------------------------------------------------------------------
// Parser helpers
// ---------------------------------------------------------------------------

/**
 * Try to extract a MEMORY_UPDATE block from agent output text.
 *
 * Agents are prompted to end their response with:
 *
 *   MEMORY_UPDATE_START
 *   section: <name>
 *   fields:
 *     - <label>: <value>
 *   url: <url>
 *   notes:
 *     - <observation>
 *   MEMORY_UPDATE_END
 *
 * Returns null if no well-formed block is found (graceful fallback).
 */
export function parseMemoryUpdate(
  agentOutput: string,
  stepId: string,
  screenshotPaths: string[],
  agentStepsUsed = 0,
): StepMemory | null {
  const match = agentOutput.match(
    /MEMORY_UPDATE_START\s*([\s\S]*?)\s*MEMORY_UPDATE_END/,
  );
  if (!match) return null;

  const block = match[1];
  const now = new Date().toISOString();

  // section
  const sectionMatch = block.match(/^section:\s*(.+)$/m);
  const section = sectionMatch ? sectionMatch[1].trim() : 'general';

  // url
  const urlMatch = block.match(/^url:\s*(.+)$/m);
  const currentUrl = urlMatch ? urlMatch[1].trim() : '';

  // fields (lines under "fields:" that start with "  - ")
  const completedFields: CompletedField[] = [];
  const fieldBlock = block.match(/fields:\s*([\s\S]*?)(?=url:|notes:|$)/);
  if (fieldBlock) {
    for (const line of fieldBlock[1].split('\n')) {
      const m = line.match(/^\s*-\s*(.+?):\s*(.+)$/);
      if (m) {
        completedFields.push({
          label: m[1].trim(),
          value: m[2].trim(),
          section,
          confirmedAt: now,
        });
      }
    }
  }

  // notes (lines under "notes:" that start with "  - ")
  const notes: string[] = [];
  const noteBlock = block.match(/notes:\s*([\s\S]*?)(?=$)/);
  if (noteBlock) {
    for (const line of noteBlock[1].split('\n')) {
      const m = line.match(/^\s*-\s*(.+)$/);
      if (m) notes.push(m[1].trim());
    }
  }

  // summary = first non-blank line before the MEMORY_UPDATE block
  const summaryLines = agentOutput
    .slice(0, agentOutput.indexOf('MEMORY_UPDATE_START'))
    .trim()
    .split('\n')
    .filter(Boolean);
  const summary = summaryLines[summaryLines.length - 1] ?? `Step ${stepId} completed`;

  return {
    stepId,
    completedAt: now,
    summary,
    completedFields,
    currentUrl,
    screenshotPaths,
    agentStepsUsed,
    notes,
  };
}

/**
 * Fallback: build a minimal StepMemory from raw output text when no
 * MEMORY_UPDATE block is present.
 */
export function buildFallbackMemory(
  stepId: string,
  agentOutput: string,
  currentUrl: string,
  screenshotPaths: string[],
  agentStepsUsed = 0,
): StepMemory {
  const lines = agentOutput.trim().split('\n').filter(Boolean);
  const summary = lines[0] ?? `Step ${stepId} completed`;
  return {
    stepId,
    completedAt: new Date().toISOString(),
    summary,
    completedFields: [],
    currentUrl,
    screenshotPaths,
    agentStepsUsed,
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class ShortTermMemoryManager {
  private session: ShortTermSession | null = null;

  // ---- Lifecycle -----------------------------------------------------------

  begin(sessionId: string, workflowId: string): void {
    this.session = {
      sessionId,
      workflowId,
      startedAt: new Date().toISOString(),
      steps: [],
      scratchPad: {
        hypotheses: [],
        investigations: [],
        notes: [],
      },
      preFlight: {},
      isBespoke: false,
      correlationMatches: [],
    };
  }

  reset(): void {
    if (this.session) {
      this.session.preFlight = {};
    }
    this.session = null;
  }

  getSession(): ShortTermSession | null {
    return this.session;
  }

  // ---- Mutations -----------------------------------------------------------

  recordStep(memory: StepMemory): void {
    if (!this.session) return;
    // Replace existing entry for same stepId (idempotent on retry)
    const idx = this.session.steps.findIndex(s => s.stepId === memory.stepId);
    if (idx >= 0) {
      this.session.steps[idx] = memory;
    } else {
      this.session.steps.push(memory);
    }
  }

  setScratchPlan(plan: string): void {
    if (!this.session) return;
    this.session.scratchPad.plan = plan;
  }

  setScratchDodDraft(dodDraft: string): void {
    if (!this.session) return;
    this.session.scratchPad.dodDraft = dodDraft;
  }

  addScratchHypothesis(note: string): void {
    if (!this.session || !note.trim()) return;
    this.session.scratchPad.hypotheses.push(note.trim());
  }

  addInvestigationNote(note: string): void {
    if (!this.session || !note.trim()) return;
    this.session.scratchPad.investigations.push(note.trim());
  }

  addScratchNote(note: string): void {
    if (!this.session || !note.trim()) return;
    this.session.scratchPad.notes.push(note.trim());
  }

  getScratchPad(): ScratchPad | null {
    return this.session?.scratchPad ?? null;
  }

  setCorrelations(matches: CorrelationMatch[], isBespoke: boolean): void {
    if (!this.session) return;
    this.session.correlationMatches = matches;
    this.session.isBespoke = isBespoke;
  }

  storePreFlightValue(params: {
    fieldId: string;
    label: string;
    kind: string;
    sensitivity: string;
    value: string;
  }): void {
    if (!this.session) return;
    const now = new Date().toISOString();
    this.session.preFlight[params.fieldId] = {
      fieldId: params.fieldId,
      label: params.label,
      kind: params.kind,
      sensitivity: params.sensitivity,
      encryptedValue: encryptText(params.value, `preflight:${params.fieldId}`),
      updatedAt: now,
    };
  }

  getPreFlightEntry(fieldId: string): PreFlightEntry | null {
    if (!this.session) return null;
    return this.session.preFlight[fieldId] ?? null;
  }

  getPreFlightValue(fieldId: string): string | null {
    const entry = this.getPreFlightEntry(fieldId);
    if (!entry) return null;
    return decryptText(entry.encryptedValue, `preflight:${fieldId}`);
  }

  clearSensitiveData(): void {
    if (!this.session) return;
    this.session.preFlight = {};
  }

  // ---- Accessors -----------------------------------------------------------

  getAllCompletedFields(): CompletedField[] {
    if (!this.session) return [];
    return this.session.steps.flatMap(s => s.completedFields);
  }

  getAllNotes(): string[] {
    if (!this.session) return [];
    return this.session.steps.flatMap(s => s.notes);
  }

  getAllScreenshotPaths(): string[] {
    if (!this.session) return [];
    return this.session.steps.flatMap(s => s.screenshotPaths);
  }

  getTotalAgentSteps(): number {
    if (!this.session) return 0;
    return this.session.steps.reduce((sum, s) => sum + s.agentStepsUsed, 0);
  }

  getCorrelationMatches(): CorrelationMatch[] {
    return this.session?.correlationMatches ?? [];
  }

  isBespoke(): boolean {
    return this.session?.isBespoke ?? false;
  }

  // ---- Prompt injection ----------------------------------------------------

  /**
   * Returns a context block to prepend to the next agent_task prompt.
   * Empty string if this is the first step (nothing completed yet).
   */
  getContextPrompt(): string {
    if (!this.session || this.session.steps.length === 0) return '';

    const lines: string[] = [];
    lines.push('=== SESSION MEMORY — do not repeat completed work ===');

    const scratchPad = this.getScratchPad();
    if (scratchPad?.plan) {
      lines.push('PRE-FLIGHT PLAN:');
      lines.push(`  ${scratchPad.plan}`);
    }
    if (scratchPad?.investigations.length) {
      lines.push('INVESTIGATION NOTES:');
      for (const note of scratchPad.investigations) {
        lines.push(`  • ${note}`);
      }
    }

    // Completed fields grouped by section
    const fields = this.getAllCompletedFields();
    if (fields.length > 0) {
      lines.push('COMPLETED FIELDS:');
      const bySection: Record<string, CompletedField[]> = {};
      for (const f of fields) {
        (bySection[f.section] ??= []).push(f);
      }
      for (const [section, sFields] of Object.entries(bySection)) {
        lines.push(`  [${section}]`);
        for (const f of sFields) {
          if (f.value === '[REDACTED]') {
            lines.push(`    ✓ ${f.label}: [REDACTED]`);
          } else {
            lines.push(`    ✓ ${f.label}: ${f.value}`);
          }
        }
      }
    }

    // Last completed step summary + URL
    const lastStep = this.session.steps[this.session.steps.length - 1];
    if (lastStep) {
      lines.push(`LAST STEP COMPLETED: "${lastStep.stepId}"`);
      lines.push(`  ${lastStep.summary}`);
      if (lastStep.currentUrl) {
        lines.push(`  Page at end of step: ${lastStep.currentUrl}`);
      }
    }

    // Carry-forward observations from prior steps
    const notes = this.getAllNotes();
    if (notes.length > 0) {
      lines.push('CARRY-FORWARD OBSERVATIONS:');
      for (const note of notes) {
        lines.push(`  • ${note}`);
      }
    }

    lines.push('=== END SESSION MEMORY ===\n');
    return lines.join('\n');
  }

  /**
   * Suffix to append to agent prompts requesting a structured memory update.
   * The agent must emit this block at the very end of its response so
   * the workflow engine can parse it and update short-term memory.
   */
  static getOutputFormatInstruction(section: string): string {
    return `
--- REQUIRED OUTPUT FORMAT ---
After completing all work, output EXACTLY the following block as the last thing in your response:

MEMORY_UPDATE_START
section: ${section}
fields:
  - <field label>: <value you confirmed was entered>
  - <field label>: <value you confirmed was entered>
url: <URL of the page when you finished>
notes:
  - <any observation about form behavior that the next step should know>
MEMORY_UPDATE_END

Only list fields you CONFIRMED were successfully filled. Do not list fields that showed validation errors.
---`;
  }
}

export const shortTermMemory = new ShortTermMemoryManager();
