/**
 * Workflow execution engine.
 *
 * Executes a WorkflowDefinition step-by-step, routing each step to the
 * appropriate underlying capability:
 *
 *   navigate / click / type / screenshot  → SessionManager (direct Playwright)
 *   extract                               → SessionManager page.evaluate
 *   agent_task                            → Router → best engine for the prompt
 *   human_takeover                        → HitlCoordinator (blocks until user returns)
 *
 * MEMORY INTEGRATION
 * ------------------
 * Short-term memory is accumulated across steps within a single run.
 * Before each agent_task the prompt is prefixed with:
 *   1. SIC block    — validated best practices from long-term memory
 *   2. Session ctx  — what was already completed this run (prevents re-work)
 *   3. Output fmt   — instructions to emit a MEMORY_UPDATE block so the next
 *                     step knows what was confirmed filled
 *
 * At workflow end a Story is written to long-term memory, and any improvements
 * observed during the run are recorded (incrementing occurrence counts toward
 * SIC promotion at 10 occurrences).
 */

import * as path from 'path';
import * as fs from 'fs';
import { sessionManager } from '../session/manager';
import { hitlCoordinator } from '../session/hitl';
import { SessionState } from '../session/types';
import { EngineId } from '../engines/interface';
import {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowResult,
  StepResult,
  AgentTaskStep,
} from './types';
import { getGeminiWriter } from '../content/gemini-writer';
import type { SocialPublishOutcome } from '../session/types';
import { registry } from '../engines/registry';
import {
  shortTermMemory,
  longTermMemory,
  memoryIndexer,
  parseMemoryUpdate,
  buildFallbackMemory,
  ShortTermMemoryManager,
  formatBankContext,
  Story,
} from '../memory';
import { wrapUpWorkflowRun } from './wrap-up';
import { telemetry } from '../telemetry';

// ---------------------------------------------------------------------------
// Intelligent router
// ---------------------------------------------------------------------------

/**
 * Pick the best engine for a given agent task prompt.
 *
 *   Exploratory multi-page tasks          → browser-use  (agent loop)
 *   Structured SOPs / form workflows      → skyvern      (workflow engine)
 *   Default                               → browser-use
 */
export async function routeAgentTask(
  prompt: string,
  preferredEngine: AgentTaskStep['engine'] = 'auto',
): Promise<EngineId> {
  if (preferredEngine && preferredEngine !== 'auto') return preferredEngine as EngineId;

  const lower = prompt.toLowerCase();

  const skyvernSignals = ['complete all steps', 'follow the process', 'fill out the form', 'submit the', 'workflow'];
  if (skyvernSignals.some(s => lower.includes(s))) {
    const available = await registry.get('skyvern').available();
    if (available) return 'skyvern';
  }

  const browserUseSignals = ['find', 'search', 'navigate to', 'look for', 'browse', 'check all', 'go through', 'fill out'];
  if (browserUseSignals.some(s => lower.includes(s))) {
    return 'browser-use';
  }

  return 'browser-use';
}

// ---------------------------------------------------------------------------
// Parameter substitution
// ---------------------------------------------------------------------------

function substitute(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const val = params[key];
    // Preserve placeholder when the key is not yet in params so a later
    // substitution pass (with runtime outputs) can still resolve it.
    if (val === undefined || val === null) return match;
    return val === '' ? '' : String(val);
  });
}

function substituteStep(step: WorkflowStep, params: Record<string, unknown>): WorkflowStep {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(step)) {
    if (typeof v === 'string') {
      result[k] = substitute(v, params);
    } else if (Array.isArray(v)) {
      result[k] = v.map(item =>
        typeof item === 'object' && item !== null
          ? substituteStep(item as WorkflowStep, params)
          : item,
      );
    } else {
      result[k] = v;
    }
  }
  return toWorkflowStep(result);
}

/**
 * Explicit typed conversion for the object produced by substituteStep.
 * Named so the substitution boundary is visible rather than hidden as an inline double-cast.
 */
function toWorkflowStep(obj: Record<string, unknown>): WorkflowStep {
  return obj as unknown as WorkflowStep;
}

// ---------------------------------------------------------------------------
// Content/output validation (US-027 / RF-009)
// ---------------------------------------------------------------------------

interface OutputValidationResult {
  valid: boolean;
  reason: string;
  details: string;
}

/**
 * Deterministic content gate applied to generated and preflight output values
 * before they reach downstream browser side effects.
 *
 * Rejects values that are empty, whitespace-only, unresolved template
 * placeholders, known generic fillers (TODO/TBD/Lorem ipsum), or structural
 * markup placeholders beginning with '<' or '[Generated'.
 */
function validateWorkflowOutput(
  outputKey: string,
  value: string,
): OutputValidationResult {
  if (value.length === 0) {
    return { valid: false, reason: 'empty_output', details: `Output '${outputKey}' is empty.` };
  }
  if (value.trim().length === 0) {
    return { valid: false, reason: 'whitespace_only', details: `Output '${outputKey}' is whitespace only.` };
  }
  const placeholders = value.match(/\{\{\w+\}\}/g);
  if (placeholders) {
    return {
      valid: false,
      reason: 'unresolved_placeholder',
      details: `Output '${outputKey}' contains unresolved placeholder(s): ${placeholders.join(', ')}.`,
    };
  }
  if (value.includes('TODO')) {
    return { valid: false, reason: 'placeholder_content', details: `Output '${outputKey}' contains 'TODO'.` };
  }
  if (value.includes('TBD')) {
    return { valid: false, reason: 'placeholder_content', details: `Output '${outputKey}' contains 'TBD'.` };
  }
  if (/lorem ipsum/i.test(value)) {
    return { valid: false, reason: 'placeholder_content', details: `Output '${outputKey}' contains 'Lorem ipsum'.` };
  }
  if (value.startsWith('[Generated')) {
    return { valid: false, reason: 'generic_content', details: `Output '${outputKey}' begins with '[Generated'.` };
  }
  if (value.startsWith('<')) {
    return { valid: false, reason: 'generic_content', details: `Output '${outputKey}' begins with '<'.` };
  }
  return { valid: true, reason: 'ok', details: '' };
}

/**
 * Shallow scan of a substituted step object for any remaining {{key}} tokens.
 * Returns the matched placeholder strings (e.g. ['{{missing_key}}']).
 * Only inspects top-level string values — deep nesting is not needed for the
 * deterministic side-effect step types this gate covers.
 */
function findUnresolvedPlaceholders(obj: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const val of Object.values(obj)) {
    if (typeof val === 'string') {
      const matches = val.match(/\{\{\w+\}\}/g);
      if (matches) found.push(...matches);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Reddit duplicate-check evidence contract parser (US-028 / RF-010)
// ---------------------------------------------------------------------------

interface RedditDuplicateEvidence {
  result: 'NO_DUPLICATE_FOUND' | 'DUPLICATE_RISK' | null;
  extractedTitles: string[] | null;
  overlapScores: Array<{ title: string; score: number }> | null;
  matchingTitle: string | null;
  errors: string[];
}

interface BrowserPostconditionValidationResult {
  valid: boolean;
  reason: string;
  details: Record<string, unknown>;
}

type BrowserPostconditionStep = Extract<
  WorkflowStep,
  { type: 'agent_task' | 'navigate' | 'click' | 'fill' | 'type' }
>;

function isBrowserPostconditionStep(step: WorkflowStep): step is BrowserPostconditionStep {
  return ['agent_task', 'navigate', 'click', 'fill', 'type'].includes(step.type);
}

function validateBrowserPostcondition(
  step: BrowserPostconditionStep,
  stepResult: StepResult,
  currentUrl: string,
  workflowOutputs: Record<string, string>,
  runtimeParams: Record<string, unknown>,
  workflowId: string,
  sessionId: string,
): BrowserPostconditionValidationResult {
  const metadata = step as BrowserPostconditionStep & {
    expectedUrlAfter?: string;
    requiredOutputIncludes?: string[];
    postconditionRequired?: boolean;
  };
  const substitutionContext = {
    ...workflowOutputs,
    ...runtimeParams,
  };
  const expectedUrl = metadata.expectedUrlAfter
    ? substitute(metadata.expectedUrlAfter, substitutionContext)
    : undefined;
  const requiredOutputIncludes = (metadata.requiredOutputIncludes ?? []).map((marker) =>
    substitute(marker, substitutionContext),
  );
  const output = stepResult.output ?? '';
  const isSubmitRedditPost = step.id === 'submit_reddit_post';
  const applies =
    isSubmitRedditPost ||
    Boolean(expectedUrl) ||
    requiredOutputIncludes.length > 0 ||
    metadata.postconditionRequired === true;

  if (!applies) {
    return {
      valid: true,
      reason: 'not_applicable',
      details: {
        workflowId,
        sessionId,
        applied: false,
      },
    };
  }

  const effectiveExpectedUrl = isSubmitRedditPost && !expectedUrl
    ? '/comments/'
    : expectedUrl;

  if (effectiveExpectedUrl && !currentUrl.includes(effectiveExpectedUrl)) {
    return {
      valid: false,
      reason: 'expected_url_missing',
      details: {
        workflowId,
        sessionId,
        expectedUrl: effectiveExpectedUrl,
        currentUrl,
      },
    };
  }

  if (requiredOutputIncludes.length > 0) {
    const missingMarkers = requiredOutputIncludes.filter((marker) => !output.includes(marker));
    if (missingMarkers.length > 0) {
      return {
        valid: false,
        reason: 'required_output_missing',
        details: {
          workflowId,
          sessionId,
          expectedUrl: effectiveExpectedUrl,
          currentUrl,
          missingMarkers,
          outputPreview: output.slice(0, 400),
        },
      };
    }
  }

  if (isSubmitRedditPost) {
    const redditCommentsUrlPattern = /(https?:\/\/)?(www\.)?reddit\.com\/r\/[^/\s]+\/comments\/[^\s)]+/i;
    if (!redditCommentsUrlPattern.test(output)) {
      return {
        valid: false,
        reason: 'comments_url_output_missing',
        details: {
          workflowId,
          sessionId,
          expectedUrl: effectiveExpectedUrl,
          currentUrl,
          outputPreview: output.slice(0, 400),
        },
      };
    }
  }

  return {
    valid: true,
    reason: 'ok',
    details: {
      workflowId,
      sessionId,
      applied: true,
      expectedUrl: effectiveExpectedUrl,
      currentUrl,
      requiredOutputIncludes,
    },
  };
}

/**
 * Deterministically parse the structured output produced by the
 * check_duplicate_reddit_post agent_task step.
 *
 * Expected lines (each on its own line):
 *   EXTRACTED_TITLES: <json array of strings>
 *   OVERLAP_SCORES: <json array of {title, score}>
 *   DUPLICATE_CHECK_RESULT: NO_DUPLICATE_FOUND | DUPLICATE_RISK
 *   MATCHING_TITLE: <title>   (required when DUPLICATE_RISK)
 */
function parseRedditDuplicateEvidence(output: string): RedditDuplicateEvidence {
  const errors: string[] = [];

  // DUPLICATE_CHECK_RESULT
  const resultMatch = output.match(/^DUPLICATE_CHECK_RESULT:\s*(.+)$/m);
  let result: 'NO_DUPLICATE_FOUND' | 'DUPLICATE_RISK' | null = null;
  if (resultMatch) {
    const raw = resultMatch[1].trim();
    if (raw === 'NO_DUPLICATE_FOUND') result = 'NO_DUPLICATE_FOUND';
    else if (raw === 'DUPLICATE_RISK') result = 'DUPLICATE_RISK';
    else errors.push(`Unrecognized DUPLICATE_CHECK_RESULT value: '${raw}'`);
  } else {
    errors.push('Missing required line: DUPLICATE_CHECK_RESULT');
  }

  // EXTRACTED_TITLES
  let extractedTitles: string[] | null = null;
  const titlesMatch = output.match(/^EXTRACTED_TITLES:\s*(.+)$/m);
  if (titlesMatch) {
    try {
      const parsed: unknown = JSON.parse(titlesMatch[1].trim());
      if (Array.isArray(parsed)) {
        extractedTitles = (parsed as unknown[]).map(String);
      } else {
        errors.push('EXTRACTED_TITLES must be a JSON array');
      }
    } catch {
      errors.push('Failed to parse EXTRACTED_TITLES as JSON');
    }
  } else {
    errors.push('Missing required line: EXTRACTED_TITLES');
  }

  // OVERLAP_SCORES
  let overlapScores: Array<{ title: string; score: number }> | null = null;
  const scoresMatch = output.match(/^OVERLAP_SCORES:\s*(.+)$/m);
  if (scoresMatch) {
    try {
      const parsed: unknown = JSON.parse(scoresMatch[1].trim());
      if (Array.isArray(parsed)) {
        const valid = (parsed as unknown[]).every(
          item =>
            typeof item === 'object' &&
            item !== null &&
            'title' in item &&
            'score' in item &&
            typeof (item as Record<string, unknown>)['score'] === 'number',
        );
        if (valid) {
          overlapScores = parsed as Array<{ title: string; score: number }>;
        } else {
          errors.push('OVERLAP_SCORES items must each have a title string and a numeric score');
        }
      } else {
        errors.push('OVERLAP_SCORES must be a JSON array');
      }
    } catch {
      errors.push('Failed to parse OVERLAP_SCORES as JSON');
    }
  } else {
    errors.push('Missing required line: OVERLAP_SCORES');
  }

  // MATCHING_TITLE (required only when DUPLICATE_RISK)
  let matchingTitle: string | null = null;
  const matchingMatch = output.match(/^MATCHING_TITLE:\s*(.+)$/m);
  if (matchingMatch) {
    matchingTitle = matchingMatch[1].trim();
  } else if (result === 'DUPLICATE_RISK') {
    errors.push('Missing required line: MATCHING_TITLE when DUPLICATE_CHECK_RESULT is DUPLICATE_RISK');
  }

  return { result, extractedTitles, overlapScores, matchingTitle, errors };
}

// ---------------------------------------------------------------------------
// US-031 / RF-013 — agent_task side-effect intent classifier
// ---------------------------------------------------------------------------

/**
 * Deterministic classifier for `agent_task` prompt side-effect intent.
 * Returns a stable classification used by the safety gate inside executeStep
 * to decide whether worker dispatch is safe to proceed.
 *
 * Dominant intent is selected from all matched signals using a deterministic
 * ranking. This prevents fallback fill text from overriding submit/publish/post/final-click intent.
 */
function classifyAgentTaskSideEffect(
  prompt: string,
  _stepId: string,
): {
  protectedIntent: boolean;
  intentKind:
    | 'submit'
    | 'publish'
    | 'post'
    | 'final_click'
    | 'login'
    | 'fill'
    | 'external_mutation'
    | 'read_only'
    | 'unknown';
  reason: string;
  details: Record<string, unknown>;
} {
  const lower = prompt.toLowerCase();
  const matchedSignals: Array<
    'submit' | 'publish' | 'post' | 'final_click' | 'login' | 'fill' | 'external_mutation' | 'read_only'
  > = [];

  const addSignal = (
    signal: 'submit' | 'publish' | 'post' | 'final_click' | 'login' | 'fill' | 'external_mutation' | 'read_only',
    matched: boolean,
  ): void => {
    if (matched) {
      matchedSignals.push(signal);
    }
  };

  addSignal('login', /\b(log\s*in|login|sign\s+in|sign\s+into|authenticate)\b/.test(lower));
  addSignal(
    'fill',
    /\bfill(?:\s+(?:in|out))?\b|\benter\s+(?:the|your|a)\s+\w+|\btype\s+(?:in|the|your)\b|\bpopulate(?:\s+the)?\s+form\b/.test(
      lower,
    ),
  );
  addSignal('submit', /\bsubmit\b/.test(lower));
  addSignal('publish', /\bpublish\b/.test(lower));
  addSignal('final_click', /\b(?:click|press|tap)\b.{0,50}\b(?:post|confirm|send|done)\b/.test(lower));
  addSignal(
    'post',
    /\bpost\s+(?:to|on|this|it|the\s+content|the\s+article)\b/.test(lower) || /^post\b/m.test(lower),
  );
  addSignal(
    'external_mutation',
    /\b(?:delete|remove|buy|purchase|pay|checkout|upload|vote|upvote|downvote|follow|subscribe|comment\s+on|send\s+message)\b/.test(
      lower,
    ),
  );
  addSignal(
    'read_only',
    /\b(?:browse|inspect|read|verify|check|summarize|analyze|review|view|list|find|search|extract|get|fetch|retrieve|report|identify|monitor|scan|duplicate)\b/.test(
      lower,
    ),
  );

  const protectedRank: Array<
    'login' | 'submit' | 'publish' | 'post' | 'final_click' | 'fill' | 'external_mutation'
  > = ['login', 'submit', 'publish', 'post', 'final_click', 'fill', 'external_mutation'];

  const selectedProtected = protectedRank.find(kind => matchedSignals.includes(kind));

  if (selectedProtected) {
    return {
      protectedIntent: true,
      intentKind: selectedProtected,
      reason: `dominant protected intent selected: ${selectedProtected}`,
      details: {
        matchedSignals,
        dominantIntentSource: 'ranked_signals',
        selectedIntent: selectedProtected,
      },
    };
  }

  if (matchedSignals.includes('read_only')) {
    return {
      protectedIntent: false,
      intentKind: 'read_only',
      reason: 'read-only intent selected: no protected signal matched',
      details: {
        matchedSignals,
        dominantIntentSource: 'read_only_fallback',
        selectedIntent: 'read_only',
      },
    };
  }

  return {
    protectedIntent: false,
    intentKind: 'unknown',
    reason: 'no intent pattern matched',
    details: {
      matchedSignals,
      dominantIntentSource: 'none',
      selectedIntent: 'unknown',
    },
  };
}

function buildRuntimeParams(
  resolvedParams: Record<string, unknown>,
  outputs: Record<string, string>,
): Record<string, unknown> {
  return {
    ...resolvedParams,
    ...outputs,
  };
}

// ---------------------------------------------------------------------------
// Memory-enhanced prompt builder
// ---------------------------------------------------------------------------

/**
 * Wrap a raw agent_task prompt with:
 *   [SIC block]        — proven best-practices from long-term memory
 *   [Session memory]   — what this workflow already completed
 *   [Original prompt]
 *   [Output format]    — request for structured MEMORY_UPDATE at end of response
 */
// Loaded once per process — bank files don't change mid-run.
const _bankContext: string = formatBankContext();

function buildEnhancedPrompt(
  rawPrompt: string,
  memorySection: string,
  guardedFields: string[] = [],
): string {
  const sicBlock = longTermMemory.getSicPromptBlock();
  const sessionCtx = shortTermMemory.getContextPrompt();
  const outputFmt = ShortTermMemoryManager.getOutputFormatInstruction(memorySection);
  const guardedBlock = guardedFields.length > 0
    ? [
        '=== HITL-CONTROLLED SENSITIVE FIELDS ===',
        `Do not request, inspect, or modify these fields: ${guardedFields.join(', ')}.`,
        'Assume HITL already handled them unless explicitly told otherwise.',
        '=== END HITL-CONTROLLED SENSITIVE FIELDS ===\n',
      ].join('\n')
    : '';

  // Bank context gives the agent foreknowledge of platform quirks, submission
  // flows, and user preferences accumulated across all previous runs.
  return [_bankContext, sicBlock, sessionCtx, guardedBlock, rawPrompt, outputFmt]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Improvement seeds — known patterns recorded from the DOT form run
// ---------------------------------------------------------------------------

/**
 * Record known improvements that we've already observed empirically.
 * Called once per workflow run so occurrence counts accumulate across runs.
 */
function seedKnownImprovements(workflowId: string): void {
  longTermMemory.recordImprovement({
    id: 'salesforce-dropdown-click-wait-select',
    category: 'dropdown',
    title: 'Salesforce dropdown: click → wait → select',
    description:
      'Salesforce Experience Cloud dropdowns do not respond reliably to ' +
      'direct select_dropdown calls. The agent must click the field, wait ' +
      '500-1000ms for the overlay to appear, then select the value. ' +
      'Re-selecting multiple times without this pattern results in persistent ' +
      '"Please select a choice" validation errors.',
    agentInstruction:
      'For any dropdown on a Salesforce/Experience Cloud form: ' +
      '(1) click the dropdown element, (2) wait 1 second, ' +
      '(3) select the desired value. Never use select_dropdown without clicking first.',
    workflowId,
  });

  longTermMemory.recordImprovement({
    id: 'autocomplete-full-name-not-code',
    category: 'autocomplete',
    title: 'Autocomplete fields: type full name, not code',
    description:
      'Airport and airline autocomplete fields on the DOT OACP form require ' +
      'the full city or airline name to trigger suggestions. Typing IATA codes ' +
      '(e.g. "SAN", "SEA", "AS") results in "Enter a valid value" errors. ' +
      'After typing, wait 2 seconds for the suggestion list before clicking.',
    agentInstruction:
      'For airport autocomplete fields: type the full city name (e.g. "San Diego", ' +
      '"Seattle") and wait 2 seconds for suggestions before clicking. ' +
      'Do NOT type IATA codes directly.',
    workflowId,
  });

  longTermMemory.recordImprovement({
    id: 'dont-re-select-confirmed-fields',
    category: 'form-validation',
    title: 'Do not re-select fields confirmed in SESSION MEMORY',
    description:
      'Agent repeatedly re-visited dropdown fields already filled in earlier ' +
      'steps, causing unnecessary delays and sometimes resetting values. ' +
      'The SESSION MEMORY block lists confirmed fields — these must not be touched.',
    agentInstruction:
      'Never re-fill or re-select a field listed under COMPLETED FIELDS in the ' +
      'SESSION MEMORY block. Trust that confirmed fields are correct and skip them.',
    workflowId,
  });
}

function recordFinalConfirmationSelfHeal(
  workflowId: string,
  stepId: string,
  reason: string,
): void {
  longTermMemory.recordImprovement({
    id: `final-confirmation-rejected-${workflowId}-${stepId}`,
    category: 'general',
    title: `Final-step rejection for ${stepId}`,
    description:
      `HITL rejected the final outcome for step "${stepId}" in workflow "${workflowId}". ` +
      `Reason: ${reason}`,
    agentInstruction:
      'For any irreversible final action, do not assume completion from a click alone. ' +
      'Verify visible success evidence first, then hand off to HITL for confirmation. ' +
      'If success evidence is missing, report the failure explicitly instead of proceeding.',
    workflowId,
  });
}

// ---------------------------------------------------------------------------
// Social publish outcome classifier
// ---------------------------------------------------------------------------

const SOCIAL_WORKFLOW_IDS = new Set([
  'post_to_x',
  'write_and_post_to_x',
  'post_to_reddit',
  'write_and_post_to_reddit',
]);

function isSocialWorkflow(workflowId: string): boolean {
  return SOCIAL_WORKFLOW_IDS.has(workflowId);
}

function isEditorialMessageParam(paramKey: string): boolean {
  return [
    'post_text',
    'post_title',
    'x_post_text',
    'reddit_post_text',
    'reddit_post_title',
  ].includes(paramKey);
}

function hasUserProvidedEditorialMessage(params: Record<string, unknown>): boolean {
  const candidateKeys = [
    'post_text',
    'post_title',
    'x_post_text',
    'reddit_post_text',
    'reddit_post_title',
  ];

  return candidateKeys.some((key) => {
    const value = params[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function detectSocialPlatform(workflowId: string): 'x' | 'reddit' | 'linkedin' {
  if (workflowId.includes('reddit')) return 'reddit';
  if (workflowId.includes('linkedin')) return 'linkedin';
  return 'x';
}

function resolveEditorialTopic(
  definition: WorkflowDefinition,
  params: Record<string, unknown>,
): string {
  const candidates = [
    params.topic,
    params.task,
    params.context,
    params.post_title,
    params.post_text,
    params.reddit_post_title,
    params.reddit_post_text,
    definition.description,
    definition.name,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return `Create a ${detectSocialPlatform(definition.id)} social post for workflow ${definition.id}.`;
}

async function bootstrapEditorialDraft(
  definition: WorkflowDefinition,
  resolvedParams: Record<string, unknown>,
  outputs: Record<string, string>,
  onStateUpdate: (state: Partial<SessionState>) => void,
  telemetryContext: { sessionId: string; workflowId: string },
): Promise<void> {
  if (!isSocialWorkflow(definition.id)) {
    telemetry.emit({
      source: 'workflow',
      name: 'workflow.content.bootstrap.skipped',
      sessionId: telemetryContext.sessionId,
      workflowId: telemetryContext.workflowId,
      details: {
        reason: 'not_social_workflow',
      },
    });
    return;
  }

  if (hasUserProvidedEditorialMessage(resolvedParams)) {
    telemetry.emit({
      source: 'workflow',
      name: 'workflow.content.bootstrap.skipped',
      sessionId: telemetryContext.sessionId,
      workflowId: telemetryContext.workflowId,
      details: {
        reason: 'user_provided_message',
      },
    });
    return;
  }

  const writer = getGeminiWriter();
  const platform = detectSocialPlatform(definition.id);
  const includeTitle = platform === 'reddit';
  const topic = resolveEditorialTopic(definition, resolvedParams);
  const tone = typeof resolvedParams.tone === 'string'
    ? resolvedParams.tone as 'factual' | 'conversational' | 'professional' | 'direct'
    : 'conversational';

  telemetry.emit({
    source: 'workflow',
    name: 'workflow.content.bootstrap.started',
    sessionId: telemetryContext.sessionId,
    workflowId: telemetryContext.workflowId,
    details: {
      platform,
      includeTitle,
      topicLength: topic.length,
    },
  });

  const generated = await writer.writePost({
    platform,
    topic,
    context: typeof resolvedParams.context === 'string' ? resolvedParams.context : undefined,
    tone,
    includeTitle,
  });

  if (platform === 'reddit') {
    if (generated.title) {
      resolvedParams.post_title = generated.title;
      resolvedParams.reddit_post_title = generated.title;
      outputs.reddit_post_title = generated.title;
    }
    resolvedParams.post_text = generated.text;
    resolvedParams.reddit_post_text = generated.text;
    outputs.post_text = generated.text;
    outputs.reddit_post_text = generated.text;
  } else {
    resolvedParams.post_text = generated.text;
    resolvedParams.x_post_text = generated.text;
    outputs.post_text = generated.text;
    outputs.x_post_text = generated.text;
  }

  shortTermMemory.addScratchNote(
    `GeminiWriter generated editorial draft during pre-flight for ${definition.id}.`,
  );

  telemetry.emit({
    source: 'workflow',
    name: 'workflow.content.bootstrap.completed',
    sessionId: telemetryContext.sessionId,
    workflowId: telemetryContext.workflowId,
    details: {
      platform,
      model: generated.model,
      hasTitle: Boolean(generated.title),
      bodyLength: generated.text.length,
    },
  });

  if (!process.env.AI_VISION_UI_PORT) {
    throw new Error(
      'GeminiWriter drafted content, but HITL review is required before posting and AI_VISION_UI_PORT is not set.',
    );
  }

  const preview = generated.title
    ? `TITLE: ${generated.title}\nBODY: ${generated.text}`
    : generated.text;

  const reviewReason = 'Editor-in-Chief review required: GeminiWriter draft pending approval';
  const reviewInstructions = [
    'Review the generated message below. Edit directly in the browser later if needed.',
    'Only continue when this message is approved as Ready for Posting.',
    '',
    preview.slice(0, 1600),
  ].join('\n');

  onStateUpdate({
    phase: 'hitl_qa',
    hitlAction: 'approve_draft',
    hitlReason: reviewReason,
    hitlInstructions: reviewInstructions,
  });

  await hitlCoordinator.requestQaPause(
    reviewReason,
    'GeminiWriter requires HITL approval before the workflow can proceed to posting steps.',
  );

  onStateUpdate({
    phase: 'running',
    hitlAction: undefined,
    hitlReason: undefined,
    hitlInstructions: undefined,
  });

  telemetry.emit({
    source: 'workflow',
    name: 'workflow.content.bootstrap.approved',
    sessionId: telemetryContext.sessionId,
    workflowId: telemetryContext.workflowId,
    details: {
      platform,
      approvedByHitl: true,
    },
  });
}

function classifySocialOutcome(
  workflowId: string,
  result: WorkflowResult,
): SocialPublishOutcome | undefined {
  if (!SOCIAL_WORKFLOW_IDS.has(workflowId)) return undefined;
  if (result.success) return 'published';

  const failedIndex = result.stepResults.findIndex(step => !step.success);
  const relevantText: string[] = [result.error ?? ''];

  if (failedIndex >= 0) {
    const failedStep = result.stepResults[failedIndex];
    relevantText.push(failedStep.output ?? '', failedStep.error ?? '');

    if (failedStep.stepId.startsWith('confirm_') && failedIndex > 0) {
      const previousStep = result.stepResults[failedIndex - 1];
      relevantText.push(previousStep.output ?? '', previousStep.error ?? '');
    }
  }

  const combined = relevantText.join(' ').toLowerCase();

  if (
    combined.includes('duplicate_risk:') ||
    combined.includes('preflight check failed') ||
    combined.includes('already said that') ||
    combined.includes('duplicate content') ||
    combined.includes('already been submitted') ||
    combined.includes('you already submitted this')
  ) return 'duplicate_rejected';

  if (combined.includes('rate limit') || combined.includes('too many requests')) return 'rate_limited';

  if (
    (combined.includes('auth') || combined.includes('login') || combined.includes('sign in')) &&
    (combined.includes('lost') || combined.includes('expired') || combined.includes('required'))
  ) return 'auth_lost';

  if (combined.includes('composer') || (combined.includes('draft') && combined.includes('lost'))) {
    return 'composer_lost_draft';
  }

  return 'unknown_publish_failure';
}

// ---------------------------------------------------------------------------
// Post-step memory recorder
// ---------------------------------------------------------------------------

/**
 * After an agent_task step, parse its output for a MEMORY_UPDATE block and
 * record the result in short-term memory.  Falls back gracefully if the
 * agent did not emit the block.
 */
async function recordAgentStepMemory(
  stepId: string,
  output: string | undefined,
  screenshotPaths: string[],
  sensitiveFieldLabels: Set<string> = new Set(),
): Promise<void> {
  const raw = output ?? '';
  const currentUrl = await sessionManager.currentUrl().catch(() => '');

  const parsed = parseMemoryUpdate(raw, stepId, screenshotPaths);
  if (parsed) {
    // Deterministically redact sensitive fields by exact label match against the
    // workflow step's declared targets (no regex over prompts/selectors).
    if (sensitiveFieldLabels.size > 0) {
      for (const f of parsed.completedFields) {
        if (sensitiveFieldLabels.has(f.label)) {
          f.value = '[REDACTED]';
        }
      }
    }
    // Patch in the live URL if the agent didn't report one
    if (!parsed.currentUrl) parsed.currentUrl = currentUrl;
    shortTermMemory.recordStep(parsed);
  } else {
    shortTermMemory.recordStep(
      buildFallbackMemory(stepId, raw, currentUrl, screenshotPaths),
    );
  }
}

async function isAuthVerificationSatisfied(
  step: Extract<WorkflowStep, { type: 'human_takeover' }>,
): Promise<boolean> {
  if (!step.authVerification) return false;

  const page = await sessionManager.getPage();
  const checks = step.authVerification;
  const matchesSignals = async (): Promise<boolean> => {
    const currentUrl = await sessionManager.currentUrl().catch(() => '');

    if ((checks.urlIncludes?.length ?? 0) > 0) {
      const matchedUrl = checks.urlIncludes!.some(fragment => currentUrl.includes(fragment));
      if (matchedUrl) return true;
    }

    if ((checks.visibleSelectors?.length ?? 0) > 0) {
      for (const selector of checks.visibleSelectors ?? []) {
        try {
          const locator = page.locator(selector).first();
          if (await locator.isVisible({ timeout: 500 })) return true;
        } catch {
          // ignore selector failures and continue checking other signals
        }
      }
    }

    if ((checks.textIncludes?.length ?? 0) > 0) {
      try {
        const pageText: string = await page.evaluate(() =>
          (document.body as HTMLElement).innerText.replace(/\s{3,}/g, '\n').trim(),
        );
        const matchedText = checks.textIncludes!.some(text => pageText.includes(text));
        if (matchedText) return true;
      } catch {
        // ignore text extraction failures
      }
    }
    return false;
  };

  if (await matchesSignals()) return true;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.waitForTimeout(750);
    if (await matchesSignals()) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Story builder
// ---------------------------------------------------------------------------

function buildStory(
  definition: WorkflowDefinition,
  sessionId: string,
  startedAt: number,
  result: WorkflowResult,
): Story {
  const session = shortTermMemory.getSession();
  const totalAgentSteps = shortTermMemory.getTotalAgentSteps();

  const outcome: Story['outcome'] = result.success
    ? 'success'
    : result.stepResults.some(s => s.success)
    ? 'partial'
    : 'failure';

  // Build a narrative summary
  const completedFields = shortTermMemory.getAllCompletedFields();
  const fieldCount = completedFields.length;
  const stepCount = result.stepResults.filter(s => s.success).length;
  const durSec = (result.durationMs / 1000).toFixed(1);

  const summary =
    `Workflow "${definition.name}" ran for ${durSec}s completing ` +
    `${stepCount}/${definition.steps.length} steps. ` +
    (fieldCount > 0
      ? `${fieldCount} form fields were confirmed filled.`
      : 'No structured field confirmations were recorded.') +
    (result.error ? ` Run ended with error: ${result.error}` : '');

  // Lessons learned from carry-forward notes
  const notes = shortTermMemory.getAllNotes();
  const lessonsLearned = notes.length > 0
    ? notes
    : result.success
    ? ['Workflow completed without notable issues.']
    : [`Workflow failed at step: ${result.stepResults.slice(-1)[0]?.stepId ?? 'unknown'}`];

  // Pull improvements we know about from this workflow
  const improvements = longTermMemory
    .getAllImprovements()
    .filter(i => i.workflowIds.includes(definition.id))
    .map(i => ({
      improvementId: i.id,
      category: i.category,
      title: i.title,
      description: i.description,
    }));

  return {
    id: `${definition.id}-${sessionId}`,
    workflowId: definition.id,
    workflowName: definition.name,
    sessionId,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    outcome,
    summary,
    lessonsLearned,
    improvements,
    metrics: {
      totalWorkflowSteps: definition.steps.length,
      totalAgentSteps: totalAgentSteps || result.stepResults.length,
      durationMs: result.durationMs,
    },
  };
}

// ---------------------------------------------------------------------------
// Step executor
// ---------------------------------------------------------------------------

async function executeStep(
  step: WorkflowStep,
  params: Record<string, unknown>,
  screenshots: WorkflowResult['screenshots'],
  outputs: Record<string, string>,
  onStateUpdate: (state: Partial<SessionState>) => void,
  telemetryContext: { sessionId: string; workflowId: string; approvalGrantedForStep?: boolean },
): Promise<StepResult> {
  const start = Date.now();
  const sub = substituteStep(step, params);
  const urlBefore = await sessionManager.currentUrl().catch(() => 'unknown');
  telemetry.emit({
    source: 'workflow',
    name: 'workflow.step.started',
    sessionId: telemetryContext.sessionId,
    workflowId: telemetryContext.workflowId,
    stepId: sub.id,
    details: { type: sub.type, urlBefore },
  });

  try {
    switch (sub.type) {
      // ----- navigate -------------------------------------------------------
      case 'navigate': {
        const targetUrl = sub.url;
        await sessionManager.navigate(targetUrl, sub.waitUntil ?? 'load');
        // Verify the browser actually landed — a dead/crashed browser silently resolves
        // goto() without navigating, leaving the page on chrome://new-tab-page/.
        const landedUrl = await sessionManager.currentUrl().catch(() => '');
        if (!landedUrl || landedUrl.startsWith('chrome://') || landedUrl === 'about:blank') {
          throw new Error(
            `Navigation to "${targetUrl}" failed: browser is on "${landedUrl}" — session may have crashed.`,
          );
        }
        return { stepId: sub.id, success: true, durationMs: Date.now() - start };
      }

      // ----- click ----------------------------------------------------------
      case 'click': {
        await sessionManager.click(sub.selector);
        return { stepId: sub.id, success: true, durationMs: Date.now() - start };
      }

      // ----- type -----------------------------------------------------------
      case 'type': {
        const field = (sub as {
          field?: {
            id?: string;
            kind?: string;
            label?: string;
            sensitivity?: string;
            source?: string;
          };
        }).field;
        const isSpi =
          field?.kind === 'dob' ||
          field?.kind === 'ssn' ||
          field?.sensitivity === 'spi';

        // Deterministic PII gating: for high-sensitivity PII, pause and require
        // secure HITL input before typing into the browser.
        if (isSpi) {
          const label = field?.label ?? 'Sensitive field';
          const fieldId = field?.id ?? sub.id;
          telemetry.emit({
            source: 'workflow',
            name: 'workflow.step.pii_wait',
            sessionId: telemetryContext.sessionId,
            workflowId: telemetryContext.workflowId,
            stepId: sub.id,
            details: {
              fieldId,
              label,
              sensitivity: field?.sensitivity ?? 'spi',
            },
          });
          let value = shortTermMemory.getPreFlightValue(fieldId);

          if (!value) {
            onStateUpdate({
              phase: 'pii_wait',
              hitlAction: 'secure_input',
              hitlReason: `PII entry required: ${label}`,
              hitlInstructions:
                'Enter the value in the secure input below. It will be typed into the browser ' +
                'without being injected into model prompts or long-term artifacts.',
              hitlFieldId: fieldId,
              hitlFieldLabel: label,
              hitlFieldSensitivity: field?.sensitivity ?? 'spi',
            });
            value = await hitlCoordinator.requestSensitiveValue(
              label,
              'Secure HITL input required for sensitive data.',
            );
            onStateUpdate({
              phase: 'running',
              hitlAction: undefined,
              hitlReason: undefined,
              hitlInstructions: undefined,
              hitlFieldId: undefined,
              hitlFieldLabel: undefined,
              hitlFieldSensitivity: undefined,
            });
            if (!value) {
              return {
                stepId: sub.id,
                success: false,
                error: `Missing secure HITL input for ${label}`,
                durationMs: Date.now() - start,
              };
            }
            shortTermMemory.storePreFlightValue({
              fieldId,
              label,
              kind: field?.kind ?? 'sensitive',
              sensitivity: field?.sensitivity ?? 'spi',
              value,
            });
          }

          await sessionManager.type(sub.selector, value, sub.clearFirst);
          shortTermMemory.addScratchNote(`Secure HITL entry completed for ${label}.`);
          return { stepId: sub.id, success: true, durationMs: Date.now() - start };
        }

        await sessionManager.type(sub.selector, sub.text, sub.clearFirst);
        return { stepId: sub.id, success: true, durationMs: Date.now() - start };
      }

      // ----- screenshot -----------------------------------------------------
      case 'screenshot': {
        const b64 = await sessionManager.screenshot();
        const screenshotDir = path.join(process.env.SESSION_DIR ?? './sessions', 'workflow');
        fs.mkdirSync(screenshotDir, { recursive: true });
        const filePath = path.join(screenshotDir, `${sub.id}-${Date.now()}.jpg`);
        fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
        screenshots.push({ path: filePath, base64: b64, stepId: sub.id });
        if (sub.outputKey) outputs[sub.outputKey] = filePath;
        return {
          stepId: sub.id,
          success: true,
          screenshotPath: filePath,
          screenshotBase64: b64,
          durationMs: Date.now() - start,
        };
      }

      // ----- fill -----------------------------------------------------------
      // Deterministic Playwright fill — bypasses browser-use for text entry.
      // Two modes:
      //   focused:true  — type into the currently focused element (no selector
      //                   lookup). Use after an agent_task that clicked the field.
      //   selector      — locate element then fill. Falls back to keyboard type.
      case 'fill': {
        const page = await sessionManager.getPage();
        const useFocused = (sub as { focused?: boolean }).focused === true;
        const text = sub.text;
        const selector = (sub as { selector?: string }).selector;

        if (useFocused) {
          // Select all existing content and replace with full text at once.
          await page.keyboard.press('Control+a');
          await page.keyboard.press('Delete');
          await page.keyboard.type(text, { delay: 0 });
        } else if (selector) {
          try {
            await page.fill(selector, text, { timeout: 8000 });
          } catch {
            await page.click(selector, { timeout: 5000 });
            await page.keyboard.press('Control+a');
            await page.keyboard.press('Delete');
            await page.keyboard.type(text, { delay: 0 });
          }
        } else {
          throw new Error('fill step requires either focused:true or a selector');
        }
        return { stepId: sub.id, success: true, durationMs: Date.now() - start };
      }

      // ----- extract --------------------------------------------------------
      case 'extract': {
        const page = await sessionManager.getPage();
        const pageText: string = await page.evaluate(() =>
          (document.body as HTMLElement).innerText.replace(/\s{3,}/g, '\n').trim(),
        );
        const result = `[Extract instruction: ${sub.instruction}]\n\n${pageText.slice(0, 4000)}`;
        outputs[sub.outputKey] = result;
        return {
          stepId: sub.id,
          success: true,
          output: result,
          durationMs: Date.now() - start,
        };
      }

      // ----- agent_task -----------------------------------------------------
      case 'agent_task': {
        const targets = (sub as {
          targets?: Array<{ label: string; kind?: string; sensitivity?: string }>;
        }).targets ?? [];
        const guardedFields = targets
          .filter(target =>
            target.kind === 'dob' ||
            target.kind === 'ssn' ||
            (target.sensitivity ?? 'none') === 'spi',
          )
          .map(target => target.label);

        if (guardedFields.length > 0) {
          onStateUpdate({
            phase: 'pii_wait',
            hitlAction: 'return_control',
            hitlReason: `HITL must complete sensitive fields: ${guardedFields.join(', ')}`,
            hitlInstructions:
              'Complete the sensitive fields manually in the browser. When done, click "Return Control to Claude".',
          });
          await hitlCoordinator.requestTakeover(
            `HITL must complete sensitive fields: ${guardedFields.join(', ')}`,
            'Sensitive fields are excluded from model prompts and must remain HITL-controlled.',
          );
          onStateUpdate({
            phase: 'running',
            hitlAction: undefined,
            hitlReason: undefined,
            hitlInstructions: undefined,
          });
          shortTermMemory.addScratchNote(
            `HITL manually completed sensitive fields before agent task: ${guardedFields.join(', ')}.`,
          );
        }

        const engineId = await routeAgentTask(sub.prompt, sub.engine);
        telemetry.emit({
          source: 'engine',
          name: 'workflow.agent_task.routed',
          sessionId: telemetryContext.sessionId,
          workflowId: telemetryContext.workflowId,
          stepId: sub.id,
          details: { engineId },
        });
        onStateUpdate({ currentStep: `${sub.id} → ${engineId}` });

        // Derive section label: prefer explicit memorySection, fallback to step id slug
        const memorySection =
          (sub as { memorySection?: string }).memorySection ??
          sub.id.replace(/[^a-z0-9]/gi, '-').toLowerCase();

        // Wrap prompt with SIC best-practices + session memory context.
        // rawPrompt=true bypasses all injection (used for single-line lookup steps
        // like duplicate checks where extra context disrupts the required output format).
        const useRawPrompt = (sub as { rawPrompt?: boolean }).rawPrompt === true;
        const enhancedPrompt = useRawPrompt
          ? sub.prompt
          : buildEnhancedPrompt(sub.prompt, memorySection, guardedFields);

        // Fail loudly if any {{key}} placeholders survived substitution —
        // this means a required upstream output was never produced.
        const unresolvedVars = sub.prompt.match(/\{\{(\w+)\}\}/g);
        if (unresolvedVars && unresolvedVars.length > 0) {
          const missingKeys = unresolvedVars.map(v => v.replace(/\{\{|\}\}/g, ''));
          const lossMsg = `agent_task step '${sub.id}' has unresolved template variables: ${missingKeys.join(', ')}. Payload was lost before this step.`;
          telemetry.emit({
            source: 'workflow',
            name: 'workflow.llm_layer.payload_loss',
            level: 'error',
            sessionId: telemetryContext.sessionId,
            workflowId: telemetryContext.workflowId,
            stepId: sub.id,
            details: { missingKeys, prompt: sub.prompt.slice(0, 300) },
          });
          return { stepId: sub.id, success: false, error: lossMsg, durationMs: Date.now() - start };
        }

        // US-031 / RF-013 — agent_task side-effect safety boundary.
        // Classify the resolved prompt intent before worker dispatch.  Only
        // runs after the unresolved-placeholder check to ensure the prompt is
        // fully materialised before classification.
        {
          const safety = classifyAgentTaskSideEffect(sub.prompt ?? '', sub.id);
          const safetyTelemetryBase = {
            source: 'workflow' as const,
            sessionId: telemetryContext.sessionId,
            workflowId: telemetryContext.workflowId,
            stepId: sub.id,
          };

          telemetry.emit({
            ...safetyTelemetryBase,
            name: 'workflow.agent_task_side_effect.evaluated',
            details: {
              protectedIntent: safety.protectedIntent,
              intentKind: safety.intentKind,
              reason: safety.reason,
              ...safety.details,
            },
          });

          if (safety.protectedIntent) {
            // (a) Approval enforcement for login and fill intents.
            //     These action kinds require a prior human-approval gate.
            //     approvalGrantedForStep is true only when the run-loop approval
            //     gate completed for this exact step; undefined means no approval
            //     was configured in the workflow.
            if (
              (safety.intentKind === 'login' || safety.intentKind === 'fill') &&
              telemetryContext.approvalGrantedForStep !== true
            ) {
              const blockReason = `agent_task '${sub.id}' blocked: ${safety.intentKind} intent requires prior human approval evidence`;
              telemetry.emit({
                ...safetyTelemetryBase,
                name: 'workflow.agent_task_side_effect.blocked',
                details: { reason: blockReason, intentKind: safety.intentKind, check: 'approval' },
              });
              return {
                stepId: sub.id,
                success: false,
                error: blockReason,
                durationMs: Date.now() - start,
              };
            }

            // (b) Content evidence enforcement for posting-style intents.
            //     If pre-generated content outputs exist and are invalid, fail
            //     before dispatch rather than posting bad content.
            //     Checks merged runtime params (includes both workflow params and
            //     prior step outputs) so evidence is found regardless of whether
            //     it came from resolved params or a prior generate_content step.
            if (safety.intentKind === 'post' || safety.intentKind === 'publish') {
              const contentKeys = [
                'reddit_post_text',
                'post_text',
                'post_body',
                'x_post_text',
                'content',
                'article_text',
              ];
              for (const key of contentKeys) {
                if (key in params) {
                  const val = params[key];
                  if (typeof val !== 'string' || val.trim().length === 0) {
                    const blockReason = `agent_task '${sub.id}' blocked: posting-style intent has empty content output '${key}'`;
                    telemetry.emit({
                      ...safetyTelemetryBase,
                      name: 'workflow.agent_task_side_effect.blocked',
                      details: {
                        reason: blockReason,
                        intentKind: safety.intentKind,
                        check: 'content',
                        outputKey: key,
                      },
                    });
                    return {
                      stepId: sub.id,
                      success: false,
                      error: blockReason,
                      durationMs: Date.now() - start,
                    };
                  }
                  if (
                    /\{\{[^}]+\}\}/.test(val) ||
                    /^(TODO|PLACEHOLDER)/i.test(val.trim())
                  ) {
                    const blockReason = `agent_task '${sub.id}' blocked: posting-style intent has invalid content in output '${key}'`;
                    telemetry.emit({
                      ...safetyTelemetryBase,
                      name: 'workflow.agent_task_side_effect.blocked',
                      details: {
                        reason: blockReason,
                        intentKind: safety.intentKind,
                        check: 'content',
                        outputKey: key,
                      },
                    });
                    return {
                      stepId: sub.id,
                      success: false,
                      error: blockReason,
                      durationMs: Date.now() - start,
                    };
                  }
                }
              }
            }

            // (c) Reddit duplicate evidence enforcement for reddit submit-style intents.
            //     Belt-and-suspenders for agent_task steps not named
            //     'submit_reddit_post' that still carry Reddit posting language.
            //     The run-loop reddit duplicate gate only fires on the canonical
            //     step id; this gate covers any agent_task with reddit intent.
            const promptLower = (sub.prompt ?? '').toLowerCase();
            const isRedditStyle =
              /\b(reddit|subreddit)\b|\/r\//.test(promptLower) &&
              (safety.intentKind === 'submit' ||
                safety.intentKind === 'post' ||
                safety.intentKind === 'final_click');

            if (isRedditStyle) {
              const storedEvidence =
                typeof params['reddit_duplicate_check_evidence'] === 'string'
                  ? params['reddit_duplicate_check_evidence']
                  : undefined;
              const storedResult =
                typeof params['reddit_duplicate_check_result'] === 'string'
                  ? params['reddit_duplicate_check_result']
                  : undefined;

              if (!storedEvidence || !storedResult) {
                const blockReason = `agent_task '${sub.id}' blocked: Reddit submission intent missing duplicate-check evidence`;
                telemetry.emit({
                  ...safetyTelemetryBase,
                  name: 'workflow.agent_task_side_effect.blocked',
                  details: {
                    reason: blockReason,
                    intentKind: safety.intentKind,
                    check: 'reddit_duplicate',
                  },
                });
                return {
                  stepId: sub.id,
                  success: false,
                  error: blockReason,
                  durationMs: Date.now() - start,
                };
              }

              const redditEvidence = parseRedditDuplicateEvidence(storedEvidence);

              if (redditEvidence.result === 'DUPLICATE_RISK') {
                const blockReason = `agent_task '${sub.id}' blocked: Reddit duplicate risk detected by safety gate`;
                telemetry.emit({
                  ...safetyTelemetryBase,
                  name: 'workflow.agent_task_side_effect.blocked',
                  details: {
                    reason: blockReason,
                    intentKind: safety.intentKind,
                    check: 'reddit_duplicate',
                    matchingTitle: redditEvidence.matchingTitle ?? '',
                  },
                });
                return {
                  stepId: sub.id,
                  success: false,
                  error: blockReason,
                  durationMs: Date.now() - start,
                };
              }

              if (redditEvidence.errors.length > 0) {
                const blockReason = `agent_task '${sub.id}' blocked: Reddit duplicate evidence invalid: ${redditEvidence.errors.join('; ')}`;
                telemetry.emit({
                  ...safetyTelemetryBase,
                  name: 'workflow.agent_task_side_effect.blocked',
                  details: {
                    reason: blockReason,
                    intentKind: safety.intentKind,
                    check: 'reddit_duplicate',
                    errors: redditEvidence.errors,
                  },
                });
                return {
                  stepId: sub.id,
                  success: false,
                  error: blockReason,
                  durationMs: Date.now() - start,
                };
              }
            }

            // All safety checks passed for a protected intent.
            telemetry.emit({
              ...safetyTelemetryBase,
              name: 'workflow.agent_task_side_effect.allowed',
              details: { intentKind: safety.intentKind, decision: 'allowed_protected' },
            });
          } else {
            // Read-only or unknown — always allowed.
            telemetry.emit({
              ...safetyTelemetryBase,
              name: 'workflow.agent_task_side_effect.allowed',
              details: {
                intentKind: safety.intentKind,
                decision: safety.intentKind === 'read_only' ? 'allowed_read_only' : 'allowed_unknown',
              },
            });
          }
        }

        // Layer 3 — LLM layer trace: step resolution → browser-use boundary
        if (params['reddit_post_title'] || params['reddit_post_text']) {
          telemetry.emit({
            source: 'engine',
            name: 'workflow.llm_layer.trace',
            sessionId: telemetryContext.sessionId,
            workflowId: telemetryContext.workflowId,
            stepId: sub.id,
            details: {
              layerFrom: 'step_resolution',
              layerTo: 'browser_use_prompt',
              title: String(params['reddit_post_title'] ?? ''),
              bodyPreview: String(params['reddit_post_text'] ?? '').slice(0, 200),
              titleLength: String(params['reddit_post_title'] ?? '').length,
              bodyLength: String(params['reddit_post_text'] ?? '').length,
              resolvedKeys: Object.keys(params).filter(k => params[k] !== undefined && params[k] !== ''),
              urlBefore,
              urlAfter: '',
            },
          });
        }

        const cookies = await sessionManager.extractCookies();
        const engine = await registry.getReady(engineId);
        const stepMaxSteps = (sub as { maxSteps?: number }).maxSteps;
        const taskResult = await engine.runTask(enhancedPrompt, {
          cookies,
          sessionId: telemetryContext.sessionId,
          workflowId: telemetryContext.workflowId,
          stepId: sub.id,
          ...(stepMaxSteps != null ? { maxSteps: stepMaxSteps } : {}),
        });
        // Re-sync the SessionManager's active page after browser-use may have
        // opened new tabs or navigated. Keeps HITL screenshots current.
        await sessionManager.syncActivePage().catch(() => {});

        // Record step in short-term memory for the next step's context
        const stepScreenshots = taskResult.screenshots?.map(s => s.path) ?? [];
        const sensitiveLabels = new Set(
          targets
            .filter(t => (t.sensitivity ?? 'none') !== 'none')
            .map(t => t.label),
        );
        await recordAgentStepMemory(sub.id, taskResult.output, stepScreenshots, sensitiveLabels);

        // Check outputFailsOn: if the agent output contains a blocked pattern, fail the step.
        const outputFailsOn = (sub as { outputFailsOn?: string[] }).outputFailsOn ?? [];
        if (taskResult.success && outputFailsOn.length > 0) {
          const output = taskResult.output ?? '';
          // Only scan the last non-empty line — agents sometimes echo the enhanced prompt
          // (SIC block + format instructions) in their output; the actual decision is always last.
          const lastLine = output.split('\n').map(l => l.trim()).filter(Boolean).pop() ?? output;
          const matchedPattern = outputFailsOn.find(pattern => lastLine.includes(pattern));
          if (matchedPattern) {
            const failReason = `Preflight check failed: agent output matched "${matchedPattern}". Output: ${output.slice(0, 300)}`;
            telemetry.emit({
              source: 'workflow',
              name: 'workflow.preflight.blocked',
              level: 'warn',
              sessionId: telemetryContext.sessionId,
              workflowId: telemetryContext.workflowId,
              stepId: sub.id,
              details: { matchedPattern, output: output.slice(0, 300) },
            });
            return {
              stepId: sub.id,
              success: false,
              output: taskResult.output,
              error: failReason,
              durationMs: Date.now() - start,
            };
          }
        }

        return {
          stepId: sub.id,
          success: taskResult.success,
          output: taskResult.output,
          error:
            taskResult.error ??
            (!taskResult.success && taskResult.output
              ? String(taskResult.output)
              : undefined),
          durationMs: Date.now() - start,
        };
      }

      // ----- human_takeover -------------------------------------------------
      case 'human_takeover': {
        const mode = sub.mode ?? 'takeover';
        const isVerificationGate = mode === 'takeover' && Boolean(sub.authVerification);
        const phase = mode === 'confirm_completion' ? 'hitl_qa' : 'awaiting_human';
        const hitlReason = isVerificationGate
          ? `Verify authenticated state: ${sub.reason}`
          : sub.reason;
        const hitlInstructions = isVerificationGate
          ? 'Verify whether the portal is already authenticated. If you are already signed in, do not log in again; simply continue. If authentication is still required, complete the login and then continue.'
          : sub.instructions;
        onStateUpdate({
          phase,
          hitlAction:
            mode === 'confirm_completion'
              ? 'confirm_completion'
              : isVerificationGate
              ? 'verify_authentication'
              : 'return_control',
          hitlReason,
          hitlInstructions,
        });
        if (mode === 'confirm_completion') {
          const confirmation = await hitlCoordinator.requestCompletionConfirmation(
            hitlReason,
            hitlInstructions,
          );
          onStateUpdate({
            phase: 'running',
            hitlAction: undefined,
            hitlReason: undefined,
            hitlInstructions: undefined,
          });
          if (!confirmation.confirmed) {
            const failureReason =
              confirmation.reason?.trim() ||
              `HITL did not confirm completion for step: ${sub.id}`;
            shortTermMemory.addScratchNote(
              `Final-step rejection for ${sub.id}: ${failureReason}`,
            );
            telemetry.emit({
              source: 'workflow',
              name: 'workflow.hitl_confirmation.rejected',
              level: 'error',
              sessionId: telemetryContext.sessionId,
              workflowId: telemetryContext.workflowId,
              stepId: sub.id,
              details: {
                reason: failureReason,
              },
            });
            recordFinalConfirmationSelfHeal(
              telemetryContext.workflowId,
              sub.id,
              failureReason,
            );
            onStateUpdate({
              phase: 'error',
              error: failureReason,
              hitlComments: failureReason,
              hitlFailureReason: failureReason,
              hitlFailureStepId: sub.id,
              hitlOutcomeConfirmed: false,
            });
            return {
              stepId: sub.id,
              success: false,
              error: failureReason,
              durationMs: Date.now() - start,
            };
          }
          onStateUpdate({
            hitlOutcomeConfirmed: true,
            hitlFailureReason: undefined,
            hitlFailureStepId: undefined,
          });
        } else {
          await hitlCoordinator.requestTakeover(hitlReason, hitlInstructions);
          onStateUpdate({
            phase: 'running',
            hitlAction: undefined,
            hitlReason: undefined,
            hitlInstructions: undefined,
          });
        }
        return { stepId: sub.id, success: true, durationMs: Date.now() - start };
      }

      // ----- generate_content -----------------------------------------------
      case 'generate_content': {
        const writer = getGeminiWriter();
        const generated = await writer.writePost({
          platform: sub.platform,
          topic: substitute(sub.topic, params),
          context: sub.context ? substitute(sub.context, params) : undefined,
          tone: sub.tone,
          includeTitle: Boolean(sub.outputTitleKey),
        });
        outputs[sub.outputKey] = generated.text;
        if (sub.outputTitleKey && generated.title) {
          outputs[sub.outputTitleKey] = generated.title;
        }

        // Validate generated body before any downstream step can consume it.
        const bodyValidation = validateWorkflowOutput(sub.outputKey, generated.text);
        if (!bodyValidation.valid) {
          telemetry.emit({
            source: 'workflow',
            name: 'workflow.output_validation.failed',
            sessionId: telemetryContext.sessionId,
            workflowId: telemetryContext.workflowId,
            stepId: sub.id,
            details: {
              stepType: sub.type,
              outputKey: sub.outputKey,
              reason: bodyValidation.reason,
              detail: bodyValidation.details,
            },
          });
          return {
            stepId: sub.id,
            success: false,
            error: `Content validation failed for '${sub.outputKey}': ${bodyValidation.details}`,
            durationMs: Date.now() - start,
          };
        }

        if (sub.outputTitleKey) {
          const titleValue = generated.title ?? '';
          const titleValidation = validateWorkflowOutput(sub.outputTitleKey, titleValue);
          if (!titleValidation.valid) {
            telemetry.emit({
              source: 'workflow',
              name: 'workflow.output_validation.failed',
              sessionId: telemetryContext.sessionId,
              workflowId: telemetryContext.workflowId,
              stepId: sub.id,
              details: {
                stepType: sub.type,
                outputKey: sub.outputTitleKey,
                reason: titleValidation.reason,
                detail: titleValidation.details,
              },
            });
            return {
              stepId: sub.id,
              success: false,
              error: `Content validation failed for '${sub.outputTitleKey}': ${titleValidation.details}`,
              durationMs: Date.now() - start,
            };
          }
        }

        telemetry.emit({
          source: 'workflow',
          name: 'workflow.output_validation.passed',
          sessionId: telemetryContext.sessionId,
          workflowId: telemetryContext.workflowId,
          stepId: sub.id,
          details: {
            stepType: sub.type,
            outputKey: sub.outputKey,
            outputTitleKey: sub.outputTitleKey ?? '',
          },
        });

        // Layer 1 — LLM layer trace: Gemini draft boundary
        {
          const traceUrl = await sessionManager.currentUrl().catch(() => '');
          const resolvedKeys = [sub.outputKey, ...(sub.outputTitleKey ? [sub.outputTitleKey] : [])];
          telemetry.emit({
            source: 'workflow',
            name: 'workflow.llm_layer.trace',
            sessionId: telemetryContext.sessionId,
            workflowId: telemetryContext.workflowId,
            stepId: sub.id,
            details: {
              layerFrom: 'gemini_draft',
              layerTo: 'workflow_outputs',
              title: generated.title ?? '',
              bodyPreview: generated.text.slice(0, 200),
              titleLength: (generated.title ?? '').length,
              bodyLength: generated.text.length,
              resolvedKeys,
              urlBefore: traceUrl,
              urlAfter: traceUrl,
            },
          });
        }

        telemetry.emit({
          source: 'workflow',
          name: 'workflow.generate_content.completed',
          sessionId: telemetryContext.sessionId,
          workflowId: telemetryContext.workflowId,
          stepId: sub.id,
          details: {
            platform: sub.platform,
            model: generated.model,
            hasTitle: Boolean(generated.title),
            bodyLength: generated.text.length,
          },
        });
        return {
          stepId: sub.id,
          success: true,
          output: generated.title
            ? `TITLE: ${generated.title}\nBODY: ${generated.text}`
            : generated.text,
          durationMs: Date.now() - start,
        };
      }

      default:
        return {
          stepId: (step as { id: string }).id,
          success: false,
          error: `Unknown step type: ${(step as { type: string }).type}`,
          durationMs: Date.now() - start,
        };
    }
  } catch (e) {
    telemetry.emit({
      source: 'workflow',
      name: 'workflow.step.failed',
      level: 'error',
      sessionId: telemetryContext.sessionId,
      workflowId: telemetryContext.workflowId,
      stepId: step.id,
      durationMs: Date.now() - start,
      details: {
        type: (step as { type?: string }).type ?? 'unknown',
        error: e instanceof Error ? e.message : String(e),
      },
    });
    return {
      stepId: step.id,
      success: false,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  } finally {
    const urlAfter = await sessionManager.currentUrl().catch(() => 'unknown');
    telemetry.emit({
      source: 'workflow',
      name: 'workflow.step.finished',
      sessionId: telemetryContext.sessionId,
      workflowId: telemetryContext.workflowId,
      stepId: sub.id,
      durationMs: Date.now() - start,
      details: { type: sub.type, urlBefore, urlAfter, pageChanged: urlBefore !== urlAfter },
    });
  }
}

interface ApprovalGateState {
  granted: boolean;
  approvedStepId?: string;
  approvedStepType?: WorkflowStep['type'];
  consumed: boolean;
}

type PreconditionDecision = 'run' | 'skip' | 'fail' | 'hitl';

interface PreconditionGateResult {
  decision: PreconditionDecision;
  reason: string;
  details: Record<string, unknown>;
}

async function evaluatePreconditionGate(
  step: WorkflowStep,
  currentUrl: string,
  outputs: Record<string, string>,
): Promise<PreconditionGateResult> {
  if (step.type === 'human_takeover' && step.authVerification && (step.mode ?? 'takeover') === 'takeover') {
    const authSatisfied = await isAuthVerificationSatisfied(step);
    if (authSatisfied) {
      return {
        decision: 'skip',
        reason: 'auth_verification_satisfied',
        details: {
          currentUrl,
          authVerification: step.authVerification,
        },
      };
    }
    return {
      decision: 'run',
      reason: 'auth_verification_not_satisfied',
      details: {
        currentUrl,
        authVerification: step.authVerification,
      },
    };
  }

  if (step.type === 'generate_content') {
    const preflightBody = outputs[step.outputKey];
    const preflightTitle = step.outputTitleKey ? outputs[step.outputTitleKey] : undefined;
    if (preflightBody && (!step.outputTitleKey || preflightTitle)) {
      const preflightBodyValidation = validateWorkflowOutput(step.outputKey, preflightBody);
      if (!preflightBodyValidation.valid) {
        return {
          decision: 'fail',
          reason: 'invalid_preflight_output',
          details: {
            outputKey: step.outputKey,
            validationReason: preflightBodyValidation.reason,
            validationDetail: preflightBodyValidation.details,
          },
        };
      }
      if (step.outputTitleKey && preflightTitle) {
        const preflightTitleValidation = validateWorkflowOutput(step.outputTitleKey, preflightTitle);
        if (!preflightTitleValidation.valid) {
          return {
            decision: 'fail',
            reason: 'invalid_preflight_output',
            details: {
              outputKey: step.outputTitleKey,
              validationReason: preflightTitleValidation.reason,
              validationDetail: preflightTitleValidation.details,
            },
          };
        }
      }
      return {
        decision: 'skip',
        reason: 'preflight_output_present',
        details: {
          outputKey: step.outputKey,
          outputTitleKey: step.outputTitleKey ?? '',
        },
      };
    }
    return {
      decision: 'run',
      reason: 'no_preflight_output',
      details: {
        outputKey: step.outputKey,
        outputTitleKey: step.outputTitleKey ?? '',
      },
    };
  }

  if (step.type === 'navigate') {
    const targetUrl = step.url;
    const alreadyAtTarget =
      currentUrl === targetUrl ||
      currentUrl.startsWith(`${targetUrl}/`) ||
      currentUrl.includes(targetUrl);
    if (alreadyAtTarget) {
      return {
        decision: 'skip',
        reason: 'already_at_target_url',
        details: {
          currentUrl,
          targetUrl,
        },
      };
    }
    return {
      decision: 'run',
      reason: 'target_url_not_matched',
      details: {
        currentUrl,
        targetUrl,
      },
    };
  }

  return {
    decision: 'run',
    reason: 'no_precondition_rule',
    details: {
      currentUrl,
    },
  };
}

function getApprovalSelector(
  selectors: string[],
  step: WorkflowStep,
): string | undefined {
  return selectors.find(selector => selector === step.id || selector === step.type);
}

function getStepName(step: WorkflowStep): string {
  if ('description' in step && typeof step.description === 'string' && step.description.trim().length > 0) {
    return step.description.trim();
  }
  return step.id;
}

// ---------------------------------------------------------------------------
// WorkflowEngine
// ---------------------------------------------------------------------------

export class WorkflowEngine {
  private _currentState: SessionState | null = null;

  get currentState(): SessionState | null {
    return this._currentState;
  }

  async run(
    definition: WorkflowDefinition,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<WorkflowResult> {
    const workflowStart = Date.now();
    const id = sessionId ?? `wf-${Date.now()}`;
    const stepResults: StepResult[] = [];
    const screenshots: WorkflowResult['screenshots'] = [];
    const outputs: Record<string, string> = {};

    // Resolve params / apply defaults
    const resolvedParams: Record<string, unknown> = { ...params };
    for (const [key, def] of Object.entries(definition.params ?? {})) {
      if (resolvedParams[key] === undefined) {
        if (def.default !== undefined) {
          resolvedParams[key] = def.default;
        } else if (def.required !== false && !(isSocialWorkflow(definition.id) && isEditorialMessageParam(key))) {
          return {
            workflowId: definition.id,
            success: false,
            stepResults: [],
            outputs: {},
            screenshots: [],
            durationMs: 0,
            error: `Missing required parameter: '${key}'`,
          };
        }
      }
    }

    const sourceSteps = definition.steps;
    const resolvedDefinition: WorkflowDefinition = {
      ...definition,
      steps: sourceSteps.map(step => substituteStep(step, resolvedParams)),
    };
    const executionDefinition = resolvedDefinition;
    const approvalSelectors = executionDefinition.permissions?.require_human_approval_before ?? [];
    const approvalState: ApprovalGateState = {
      granted: false,
      approvedStepId: undefined,
      approvedStepType: undefined,
      consumed: false,
    };

    // Ensure browser session is running before any work (including YAML loop)
    await sessionManager.start();
    hitlCoordinator.syncPhase('running');
    sessionManager.startScreenshotTimer(5000);

    // Canonical direct-path state publication wrapper (US-023 Phase 1).
    // All phase transitions in the direct engine must go through this function so
    // that workflowEngine.currentState and hitlCoordinator._phase stay atomically
    // aligned and the WebSocket/UI projection always receives a full SessionState.
    const publishStateTransition = (
      partial: Partial<SessionState>,
      source?: string,
    ): void => {
      const previousPhase = this._currentState?.phase;
      this._currentState = {
        id,
        phase: 'running',
        startedAt: new Date(workflowStart),
        lastUpdatedAt: new Date(),
        ...this._currentState,
        ...partial,
      };
      if (partial.phase && partial.phase !== previousPhase) {
        // Sync hitlCoordinator._phase before the event fires so every listener
        // sees both surfaces in agreement.
        hitlCoordinator.syncPhase(partial.phase);
      }
      // Broadcast the full SessionState snapshot (not just { phase }).
      hitlCoordinator.emit('phase_changed', this._currentState);
      if (partial.phase && partial.phase !== previousPhase) {
        telemetry.emit({
          source: 'workflow',
          name: 'workflow.phase.changed',
          sessionId: id,
          workflowId: definition.id,
          details: {
            phase: partial.phase,
            source: source ?? 'engine',
            currentStep: this._currentState.currentStep ?? '',
          },
        });
      }
    };

    // Alias with the narrower signature expected by executeStep and
    // bootstrapEditorialDraft parameters.
    const onStateUpdate = (partial: Partial<SessionState>): void =>
      publishStateTransition(partial);

    // ---- Route agentic YAML workflows to the Claude orchestrator loop ----
    // mode: direct (default) → step-by-step engine (fast, deterministic)
    // mode: agentic           → Claude orchestrator loop (open-ended reasoning)
    if (executionDefinition.source === 'yaml' && executionDefinition.mode === 'agentic') {
      const { runOrchestratorLoop } = await import('../orchestrator/loop');
      return runOrchestratorLoop(executionDefinition, resolvedParams, id, onStateUpdate);
    }

    // ---- Begin short-term memory for this run ----
    shortTermMemory.begin(id, definition.id);
    telemetry.emit({
      source: 'workflow',
      name: 'workflow.run.started',
      sessionId: id,
      workflowId: definition.id,
      details: {
        workflowName: definition.name,
        stepCount: executionDefinition.steps.length,
      },
    });

    // ---- Seed known improvements into long-term memory ----
    seedKnownImprovements(definition.id);

    onStateUpdate({
      id,
      phase: 'pre_flight',
      totalSteps: executionDefinition.steps.length,
      completedSteps: 0,
      startedAt: new Date(workflowStart),
      lastUpdatedAt: new Date(),
    });

    const correlationMatches = memoryIndexer.findCorrelations(resolvedDefinition);
    const correlationSummary = memoryIndexer.summarize(correlationMatches);
    const isBespoke = memoryIndexer.isBespoke(resolvedDefinition);
    telemetry.emit({
      source: 'workflow',
      name: 'workflow.preflight.completed',
      sessionId: id,
      workflowId: definition.id,
      details: {
        correlationSummary,
        isBespoke,
        matchCount: correlationMatches.length,
      },
    });
    shortTermMemory.setCorrelations(correlationMatches, isBespoke);
    shortTermMemory.setScratchPlan(
      isBespoke
        ? 'No strong historical correlation. Slow down, inspect the portal, and verify each transition before execution.'
        : `Use the strongest prior correlation as baseline: ${correlationSummary}`,
    );
    shortTermMemory.addScratchNote(`Correlation summary: ${correlationSummary}`);

    onStateUpdate({
      phase: 'pre_flight',
      correlationSummary,
      isBespoke,
    });

    try {
      await bootstrapEditorialDraft(
        executionDefinition,
        resolvedParams,
        outputs,
        onStateUpdate,
        { sessionId: id, workflowId: definition.id },
      );
    } catch (e) {
      const errorText = e instanceof Error ? e.message : String(e);
      onStateUpdate({
        phase: 'error',
        error: errorText,
      });
      telemetry.emit({
        source: 'workflow',
        name: 'workflow.content.bootstrap.failed',
        level: 'error',
        sessionId: id,
        workflowId: definition.id,
        details: {
          error: errorText,
        },
      });
      return {
        workflowId: definition.id,
        success: false,
        stepResults,
        outputs,
        screenshots,
        durationMs: Date.now() - workflowStart,
        error: errorText,
      };
    }

    if (isBespoke) {
      shortTermMemory.addInvestigationNote(
        'Bespoke task detected. Inspect portal layers, shapes, and validation behavior before trusting automation.',
      );
      onStateUpdate({ phase: 'investigation' });
    }

    onStateUpdate({ phase: 'running' });

    // Step types that can reach browser side effects and must be checked for
    // unresolved downstream placeholders before execution.
    const DOWNSTREAM_SIDE_EFFECT_STEP_TYPES = new Set([
      'agent_task', 'fill', 'type', 'click', 'navigate',
    ]);

    let finalResult: WorkflowResult;

    try {
      for (let i = 0; i < executionDefinition.steps.length; i++) {
        const stepTemplate = executionDefinition.steps[i];
        // Re-resolve each step against live outputs so same-run placeholders
        // (for example {{x_post_text}}) are available to downstream steps.
        const runtimeParams = buildRuntimeParams(resolvedParams, outputs);
        const step = substituteStep(stepTemplate, runtimeParams);

        // Layer 2 — LLM layer trace: workflow_outputs → step_resolution boundary.
        // Fire when a resolved agent_task step carries generated Reddit content so
        // the handoff from runtime outputs into a concrete step prompt is observable.
        if (
          step.type === 'agent_task' &&
          runtimeParams['reddit_post_title'] &&
          runtimeParams['reddit_post_text']
        ) {
          const traceUrl2 = await sessionManager.currentUrl().catch(() => '');
          telemetry.emit({
            source: 'workflow',
            name: 'workflow.llm_layer.trace',
            sessionId: id,
            workflowId: definition.id,
            stepId: step.id,
            details: {
              layerFrom: 'workflow_outputs',
              layerTo: 'step_resolution',
              title: String(runtimeParams['reddit_post_title'] ?? ''),
              bodyPreview: String(runtimeParams['reddit_post_text'] ?? '').slice(0, 200),
              titleLength: String(runtimeParams['reddit_post_title'] ?? '').length,
              bodyLength: String(runtimeParams['reddit_post_text'] ?? '').length,
              resolvedKeys: Object.keys(runtimeParams).filter(
                k => runtimeParams[k] !== undefined && runtimeParams[k] !== '',
              ),
              urlBefore: traceUrl2,
              urlAfter: '',
            },
          });
        }

        const currentUrlBeforeStep = await sessionManager.currentUrl().catch(() => '');
        onStateUpdate({
          currentStep: step.id,
          stepIndex: i + 1,
          completedSteps: i,
          currentUrl: currentUrlBeforeStep || undefined,
        });

        const precondition = await evaluatePreconditionGate(step, currentUrlBeforeStep, outputs);
        const preconditionTelemetryDetails = {
          stepType: step.type,
          decision: precondition.decision,
          reason: precondition.reason,
          details: precondition.details,
          currentUrl: currentUrlBeforeStep,
        };

        telemetry.emit({
          source: 'workflow',
          name: 'workflow.precondition.evaluated',
          sessionId: id,
          workflowId: definition.id,
          stepId: step.id,
          details: preconditionTelemetryDetails,
        });

        if (precondition.decision === 'skip') {
          shortTermMemory.addScratchNote(
            `Precondition skipped ${step.id} (${step.type}): ${precondition.reason}`,
          );
          telemetry.emit({
            source: 'workflow',
            name: 'workflow.precondition.skipped',
            sessionId: id,
            workflowId: definition.id,
            stepId: step.id,
            details: preconditionTelemetryDetails,
          });
          stepResults.push({
            stepId: step.id,
            success: true,
            durationMs: 0,
            output: JSON.stringify({
              stepId: step.id,
              stepType: step.type,
              decision: precondition.decision,
              reason: precondition.reason,
              details: precondition.details,
            }),
          });
          continue;
        }

        if (precondition.decision === 'fail') {
          const failMsg = precondition.reason === 'invalid_preflight_output'
            ? `Preflight content validation failed for '${String(precondition.details['outputKey'] ?? '')}': ${String(precondition.details['validationDetail'] ?? 'Invalid preflight output')}`
            : `Precondition failed for step '${step.id}' (${step.type}): ${precondition.reason}`;
          telemetry.emit({
            source: 'workflow',
            name: 'workflow.precondition.failed',
            sessionId: id,
            workflowId: definition.id,
            stepId: step.id,
            details: preconditionTelemetryDetails,
          });
          if (precondition.reason === 'invalid_preflight_output') {
            telemetry.emit({
              source: 'workflow',
              name: 'workflow.output_validation.failed',
              sessionId: id,
              workflowId: definition.id,
              stepId: step.id,
              details: {
                stepType: step.type,
                outputKey: String(precondition.details['outputKey'] ?? ''),
                reason: String(precondition.details['validationReason'] ?? precondition.reason),
                detail: String(precondition.details['validationDetail'] ?? failMsg),
              },
            });
          }
          stepResults.push({
            stepId: step.id,
            success: false,
            error: failMsg,
            durationMs: 0,
          });
          onStateUpdate({ phase: 'error', error: failMsg });
          finalResult = {
            workflowId: definition.id,
            success: false,
            stepResults,
            outputs,
            screenshots,
            durationMs: Date.now() - workflowStart,
            error: failMsg,
          };
          break;
        }

        // Downstream unresolved-placeholder gate (US-027 / RF-009).
        // Fail fast when a side-effect step still carries {{key}} tokens after
        // runtime substitution — this means a required upstream output was never
        // produced and the step must not reach the browser.
        if (DOWNSTREAM_SIDE_EFFECT_STEP_TYPES.has(step.type)) {
          const unresolved = findUnresolvedPlaceholders(step as unknown as Record<string, unknown>);
          if (unresolved.length > 0) {
            const failMsg = `Step '${step.id}' (${step.type}) has unresolved placeholders before execution: ${unresolved.join(', ')}`;
            telemetry.emit({
              source: 'workflow',
              name: 'workflow.output_validation.failed',
              sessionId: id,
              workflowId: definition.id,
              stepId: step.id,
              details: {
                stepType: step.type,
                outputKey: '',
                reason: 'unresolved_downstream_placeholder',
                detail: failMsg,
              },
            });
            telemetry.emit({
              source: 'workflow',
              name: 'workflow.precondition.failed',
              sessionId: id,
              workflowId: definition.id,
              stepId: step.id,
              details: {
                stepType: step.type,
                decision: 'fail',
                reason: 'unresolved_downstream_placeholder',
                details: {
                  unresolved,
                },
                currentUrl: currentUrlBeforeStep,
              },
            });
            const placeholderFailResult: StepResult = {
              stepId: step.id,
              success: false,
              error: failMsg,
              durationMs: 0,
            };
            stepResults.push(placeholderFailResult);
            onStateUpdate({ phase: 'error', error: failMsg });
            finalResult = {
              workflowId: definition.id,
              success: false,
              stepResults,
              outputs,
              screenshots,
              durationMs: Date.now() - workflowStart,
              error: `Step '${step.id}' failed: ${failMsg}`,
            };
            break;
          }
        }

        // Pre-execute: Reddit duplicate-check evidence gate (US-028 / RF-010).
        // submit_reddit_post cannot reach executeStep unless valid NO_DUPLICATE_FOUND
        // evidence from this same run is stored in outputs.
        if (step.id === 'submit_reddit_post') {
          const storedEvidence = outputs['reddit_duplicate_check_evidence'];
          const storedResult = outputs['reddit_duplicate_check_result'];
          let submitBlockReason: string | null = null;

          if (!storedEvidence || !storedResult) {
            submitBlockReason = 'submit_reddit_post blocked: no duplicate-check evidence found in workflow outputs. Run check_duplicate_reddit_post first.';
          } else {
            // Re-parse to validate completeness — evidence may have been stored from a prior run
            // or manually injected; we must validate it again at the gate boundary.
            const evidence = parseRedditDuplicateEvidence(storedEvidence);
            if (evidence.errors.length > 0) {
              submitBlockReason = `submit_reddit_post blocked: duplicate-check evidence invalid: ${evidence.errors.join('; ')}`;
            } else if (!evidence.extractedTitles || evidence.extractedTitles.length === 0) {
              submitBlockReason = 'submit_reddit_post blocked: duplicate-check evidence missing extracted titles';
            } else if (!evidence.overlapScores || evidence.overlapScores.length === 0) {
              submitBlockReason = 'submit_reddit_post blocked: duplicate-check evidence missing overlap scores';
            } else {
              const allScores = evidence.overlapScores.map(s => s.score);
              const outOfRange = allScores.filter(s => s < 0 || s > 1);
              if (outOfRange.length > 0) {
                submitBlockReason = `submit_reddit_post blocked: overlap scores out of 0..1 range: ${outOfRange.join(', ')}`;
              } else if (evidence.result === 'DUPLICATE_RISK') {
                submitBlockReason = `submit_reddit_post blocked: duplicate risk detected. Matching title: ${evidence.matchingTitle ?? 'unknown'}`;
              } else if (allScores.some(s => s >= 0.70) && evidence.result === 'NO_DUPLICATE_FOUND') {
                const maxScore = Math.max(...allScores);
                submitBlockReason = `submit_reddit_post blocked: score ${maxScore.toFixed(2)} >= 0.70 threshold but result claims NO_DUPLICATE_FOUND`;
              }
            }
          }

          if (submitBlockReason) {
            const isDuplicateRisk = submitBlockReason.includes('duplicate risk');
            const eventName = isDuplicateRisk
              ? 'workflow.reddit_duplicate_check.duplicate_risk'
              : 'workflow.reddit_duplicate_check.evidence_failed';
            const evidenceForTelemetry = storedEvidence
              ? parseRedditDuplicateEvidence(storedEvidence)
              : null;
            const allScoresForTelemetry = evidenceForTelemetry?.overlapScores?.map(s => s.score) ?? [];
            telemetry.emit({
              source: 'workflow',
              name: eventName,
              sessionId: id,
              workflowId: definition.id,
              stepId: step.id,
              details: {
                subreddit: String(runtimeParams['subreddit'] ?? ''),
                candidateTitle: String(runtimeParams['post_title'] ?? runtimeParams['reddit_post_title'] ?? ''),
                extractedTitleCount: evidenceForTelemetry?.extractedTitles?.length ?? 0,
                maxScore: allScoresForTelemetry.length > 0 ? Math.max(...allScoresForTelemetry) : 0,
                matchingTitle: evidenceForTelemetry?.matchingTitle ?? undefined,
                blockReason: submitBlockReason,
              },
            });
            const dupGateResult: StepResult = {
              stepId: step.id,
              success: false,
              error: submitBlockReason,
              durationMs: 0,
            };
            stepResults.push(dupGateResult);
            onStateUpdate({ phase: 'error', error: submitBlockReason });
            finalResult = {
              workflowId: definition.id,
              success: false,
              stepResults,
              outputs,
              screenshots,
              durationMs: Date.now() - workflowStart,
              error: submitBlockReason,
            };
            break;
          }
        }

        const approvalSelector = getApprovalSelector(approvalSelectors, step);
        if (approvalSelector) {
          const stepName = getStepName(step);
          const approvalReason = `Approval required before protected step: ${stepName}`;
          const alreadyApprovedForStep =
            approvalState.granted &&
            approvalState.approvedStepId === step.id &&
            approvalState.approvedStepType === step.type;

          if (approvalState.granted && !alreadyApprovedForStep) {
            throw new Error(
              `Approval state mismatch before executing protected step '${step.id}' (${step.type}).`,
            );
          }

          if (!alreadyApprovedForStep) {
            telemetry.emit({
              source: 'workflow',
              name: 'workflow.gate.approval.required',
              sessionId: id,
              workflowId: definition.id,
              stepId: step.id,
              details: {
                stepType: step.type,
                stepName,
                gateDecision: 'protected_step',
                approvalSelector,
                approvalReason,
              },
            });

            onStateUpdate({
              phase: 'hitl_qa',
              hitlAction: 'approve_step',
              currentStep: step.id,
              hitlReason: approvalReason,
              hitlInstructions: [
                'Approve this protected step before execution can continue.',
                `Step ID: ${step.id}`,
                `Step Type: ${step.type}`,
                `Step Name: ${stepName}`,
                `Approval Selector: ${approvalSelector}`,
              ].join('\n'),
            });

            telemetry.emit({
              source: 'workflow',
              name: 'workflow.gate.approval.waiting',
              sessionId: id,
              workflowId: definition.id,
              stepId: step.id,
              details: {
                stepType: step.type,
                stepName,
                gateDecision: 'waiting_for_approval',
                approvalSelector,
                approvalReason,
              },
            });

            await hitlCoordinator.requestQaPause(
              approvalReason,
              `Human approval required before protected step "${stepName}" can execute.`,
            );

            approvalState.granted = true;
            approvalState.approvedStepId = step.id;
            approvalState.approvedStepType = step.type;
            approvalState.consumed = false;

            if (
              approvalState.approvedStepId !== step.id ||
              approvalState.approvedStepType !== step.type
            ) {
              throw new Error(
                `Approval recorded for the wrong step before executing '${step.id}' (${step.type}).`,
              );
            }

            telemetry.emit({
              source: 'workflow',
              name: 'workflow.gate.approval.approved',
              sessionId: id,
              workflowId: definition.id,
              stepId: step.id,
              details: {
                stepType: step.type,
                stepName,
                gateDecision: 'approved_after_wait',
                approvalSelector,
                approvalReason,
              },
            });

            onStateUpdate({
              phase: 'running',
              hitlAction: undefined,
              hitlReason: undefined,
              hitlInstructions: undefined,
            });
          }
        }

        const approvalGrantedForStep: boolean | undefined =
          approvalSelector !== null
            ? approvalState.granted &&
              approvalState.approvedStepId === step.id &&
              approvalState.approvedStepType === step.type
              ? true
              : false
            : undefined;

        const result = await executeStep(
          step,
          runtimeParams,
          screenshots,
          outputs,
          onStateUpdate,
          { sessionId: id, workflowId: definition.id, approvalGrantedForStep },
        );

        const currentUrlAfterStep = await sessionManager.currentUrl().catch(() => '');
        onStateUpdate({ currentUrl: currentUrlAfterStep });

        let effectiveResult = result;
        if (result.success && isBrowserPostconditionStep(step)) {
          const postcondition = validateBrowserPostcondition(
            step,
            result,
            currentUrlAfterStep,
            outputs,
            runtimeParams,
            definition.id,
            id,
          );

          if (postcondition.reason !== 'not_applicable') {
            const telemetryDetails = {
              stepType: step.type,
              currentUrl: currentUrlAfterStep,
              expectedUrl: postcondition.details['expectedUrl'],
              reason: postcondition.reason,
              details: postcondition.details,
            };

            if (!postcondition.valid) {
              const failureReason = `Browser postcondition failed for step '${step.id}': ${postcondition.reason}`;
              telemetry.emit({
                source: 'workflow',
                name: 'workflow.browser_postcondition.failed',
                sessionId: id,
                workflowId: definition.id,
                stepId: step.id,
                details: telemetryDetails,
              });
              effectiveResult = {
                ...result,
                success: false,
                error: failureReason,
              };
            } else {
              telemetry.emit({
                source: 'workflow',
                name: 'workflow.browser_postcondition.passed',
                sessionId: id,
                workflowId: definition.id,
                stepId: step.id,
                details: telemetryDetails,
              });
            }
          }
        }

        if (approvalSelector && approvalState.granted) {
          telemetry.emit({
            source: 'workflow',
            name: 'workflow.gate.approval.consumed',
            sessionId: id,
            workflowId: definition.id,
            stepId: step.id,
            details: {
              stepType: step.type,
              stepName: getStepName(step),
              gateDecision: 'approval_consumed',
              approvalSelector,
            },
          });
          approvalState.granted = false;
          approvalState.approvedStepId = undefined;
          approvalState.approvedStepType = undefined;
          approvalState.consumed = true;
        }

        stepResults.push(effectiveResult);

        // Post-execution: parse Reddit duplicate-check evidence (US-028 / RF-010).
        // When the check_duplicate_reddit_post step succeeds, parse its structured
        // output and store the evidence in workflow outputs before any downstream step runs.
        if (step.id === 'check_duplicate_reddit_post' && effectiveResult.success) {
          const rawOutput = effectiveResult.output ?? '';
          const evidence = parseRedditDuplicateEvidence(rawOutput);

          if (evidence.errors.length > 0) {
            // Evidence is malformed — fail the run before any submit step can be reached.
            const failMsg = `Duplicate-check evidence invalid: ${evidence.errors.join('; ')}`;
            telemetry.emit({
              source: 'workflow',
              name: 'workflow.reddit_duplicate_check.evidence_failed',
              sessionId: id,
              workflowId: definition.id,
              stepId: step.id,
              details: {
                subreddit: String(runtimeParams['subreddit'] ?? ''),
                candidateTitle: String(runtimeParams['post_title'] ?? runtimeParams['reddit_post_title'] ?? ''),
                errors: evidence.errors,
              },
            });
            onStateUpdate({ phase: 'error', error: failMsg });
            finalResult = {
              workflowId: definition.id,
              success: false,
              stepResults,
              outputs,
              screenshots,
              durationMs: Date.now() - workflowStart,
              error: failMsg,
            };
            break;
          }

          // Validate score range
          const allScores = (evidence.overlapScores ?? []).map(s => s.score);
          const outOfRange = allScores.filter(s => s < 0 || s > 1);
          if (outOfRange.length > 0) {
            const failMsg = `Duplicate-check evidence invalid: scores out of 0..1 range: ${outOfRange.join(', ')}`;
            telemetry.emit({
              source: 'workflow',
              name: 'workflow.reddit_duplicate_check.evidence_failed',
              sessionId: id,
              workflowId: definition.id,
              stepId: step.id,
              details: {
                subreddit: String(runtimeParams['subreddit'] ?? ''),
                candidateTitle: String(runtimeParams['post_title'] ?? runtimeParams['reddit_post_title'] ?? ''),
                errors: [failMsg],
                outOfRange,
              },
            });
            onStateUpdate({ phase: 'error', error: failMsg });
            finalResult = {
              workflowId: definition.id,
              success: false,
              stepResults,
              outputs,
              screenshots,
              durationMs: Date.now() - workflowStart,
              error: failMsg,
            };
            break;
          }

          // Store evidence in workflow outputs
          outputs['reddit_duplicate_check_evidence'] = rawOutput;
          outputs['reddit_duplicate_check_result'] = evidence.result ?? '';
          if (evidence.matchingTitle) {
            outputs['reddit_duplicate_matching_title'] = evidence.matchingTitle;
          }

          const maxScore = allScores.length > 0 ? Math.max(...allScores) : 0;
          telemetry.emit({
            source: 'workflow',
            name: 'workflow.reddit_duplicate_check.evidence_parsed',
            sessionId: id,
            workflowId: definition.id,
            stepId: step.id,
            details: {
              subreddit: String(runtimeParams['subreddit'] ?? ''),
              candidateTitle: String(runtimeParams['post_title'] ?? runtimeParams['reddit_post_title'] ?? ''),
              extractedTitleCount: (evidence.extractedTitles ?? []).length,
              maxScore,
              result: evidence.result,
              matchingTitle: evidence.matchingTitle ?? undefined,
            },
          });
        }

        if (!effectiveResult.success) {
          onStateUpdate({ phase: 'error', error: effectiveResult.error });
          finalResult = {
            workflowId: definition.id,
            success: false,
            stepResults,
            outputs,
            screenshots,
            durationMs: Date.now() - workflowStart,
            error: `Step '${step.id}' failed: ${effectiveResult.error}`,
          };
          break;
        }
      }

      if (!finalResult!) {
        onStateUpdate({ phase: 'complete', completedSteps: executionDefinition.steps.length });
        finalResult = {
          workflowId: definition.id,
          success: true,
          stepResults,
          outputs,
          screenshots,
          durationMs: Date.now() - workflowStart,
        };
      }
    } catch (e) {
      onStateUpdate({
        phase: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
      finalResult = {
        workflowId: definition.id,
        success: false,
        stepResults,
        outputs,
        screenshots,
        durationMs: Date.now() - workflowStart,
        error: e instanceof Error ? e.message : String(e),
      };
    } finally {
      sessionManager.stopScreenshotTimer();
    }

    if (process.env.AI_VISION_UI_PORT && !finalResult.success) {
      // Only pause on failure so the human can review the error before the run closes.
      // On success the workflow completes immediately — no ambiguous "wrap-up" gate.
      const errorDetail = finalResult.error ?? 'Workflow did not complete successfully.';
      onStateUpdate({
        phase: 'hitl_qa',
        hitlAction: 'capture_notes',
        hitlReason: 'Workflow ended with an error — review before closing',
        hitlInstructions:
          `ERROR: ${errorDetail}\n\n` +
          'Check the browser and telemetry for what went wrong. ' +
          'Record any notes, then click "Dismiss & Close" to end the session.',
        error: finalResult.error,
      });
      await hitlCoordinator.requestQaPause(
        'Workflow error review',
        'Human review required before closing a failed workflow run.',
      );
      onStateUpdate({
        phase: 'error',
        hitlAction: undefined,
        hitlReason: undefined,
        hitlInstructions: undefined,
        error: finalResult.error,
      });
    }

    // ---- Write long-term story ----
    try {
      await wrapUpWorkflowRun({
        definition: executionDefinition,
        sessionId: id,
        startedAt: workflowStart,
        result: finalResult,
        finalState: this._currentState,
      });
      telemetry.emit({
        source: 'wrapup',
        name: 'workflow.wrapup.completed',
        sessionId: id,
        workflowId: definition.id,
        details: {
          success: finalResult.success,
          durationMs: finalResult.durationMs,
        },
      });
    } catch (e) {
      // Non-fatal — don't let ETL/wrap-up break the workflow result
      console.error('[workflow] Failed to wrap up session:', e);
      telemetry.emit({
        source: 'wrapup',
        name: 'workflow.wrapup.failed',
        level: 'error',
        sessionId: id,
        workflowId: definition.id,
        details: {
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }

    // Classify social publish outcomes (post_to_x and future social workflows)
    const socialOutcome = classifySocialOutcome(definition.id, finalResult);
    if (socialOutcome) {
      finalResult.socialPublishOutcome = socialOutcome;
      onStateUpdate({ socialPublishOutcome: socialOutcome });
      telemetry.emit({
        source: 'workflow',
        name: 'workflow.social.outcome',
        level: socialOutcome === 'published' ? 'info' : 'warn',
        sessionId: id,
        workflowId: definition.id,
        details: { socialPublishOutcome: socialOutcome },
      });
    }

    telemetry.emit({
      source: 'workflow',
      name: finalResult.success ? 'workflow.run.completed' : 'workflow.run.failed',
      level: finalResult.success ? 'info' : 'error',
      sessionId: id,
      workflowId: definition.id,
      durationMs: finalResult.durationMs,
      details: {
        success: finalResult.success,
        error: finalResult.error ?? '',
        ...(socialOutcome ? { socialPublishOutcome: socialOutcome } : {}),
      },
    });

    // Release the CDP port so the next workflow run can start a fresh browser
    // without hitting a port-already-in-use error on its first spawn attempt.
    await sessionManager.close().catch(() => {});

    return finalResult;
  }
}

export const workflowEngine = new WorkflowEngine();
