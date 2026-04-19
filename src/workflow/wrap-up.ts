import * as fs from 'fs';
import * as path from 'path';
import { SessionRepository } from '../db/repository';
import { taskMetadata, TaskMetadataRecord } from '../memory/metadata';
import {
  longTermMemory,
  shortTermMemory,
  SicTrigger,
  ScratchPad,
  ShortTermSession,
  Story,
} from '../memory';
import { SessionState } from '../session/types';
import { telemetry } from '../telemetry';
import { WorkflowDefinition, WorkflowResult } from './types';

interface WrapUpInput {
  definition: WorkflowDefinition;
  sessionId: string;
  startedAt: number;
  result: WorkflowResult;
  finalState: SessionState | null;
}

interface WrapUpArtifact {
  sessionId: string;
  workflowId: string;
  result: WorkflowResult;
  shortTerm: ShortTermSession | null;
  finalState: SessionState | null;
  tokenizerLedgerPath?: string;
  sicTrigger?: SicTrigger;
  storyId: string;
  wrappedAt: string;
}

function memoryDir(): string {
  return (
    process.env.AI_VISION_MEMORY_DIR ??
    path.join(process.env.HOME ?? process.cwd(), '.ai-vision', 'memory')
  );
}

function wrapUpsDir(): string {
  return path.join(memoryDir(), 'wrap-ups');
}

function sicTriggersDir(): string {
  return path.join(memoryDir(), 'sic-triggers');
}

function ensureDirs(): void {
  fs.mkdirSync(wrapUpsDir(), { recursive: true });
  fs.mkdirSync(sicTriggersDir(), { recursive: true });
}

function safeDomain(urlText: string): string {
  try {
    return new URL(urlText).hostname;
  } catch {
    return '';
  }
}

function renderScratchPadMarkdown(scratchPad: ScratchPad | null): string {
  if (!scratchPad) return '# Scratch Pad\n\n_No scratch pad data captured._\n';

  const lines: string[] = ['# Scratch Pad', ''];
  lines.push('## Plan', '', scratchPad.plan ?? '_No pre-flight plan captured._', '');

  lines.push('## Hypotheses', '');
  if (scratchPad.hypotheses.length === 0) {
    lines.push('_None_');
  } else {
    lines.push(...scratchPad.hypotheses.map(note => `- ${note}`));
  }
  lines.push('');

  lines.push('## Investigation', '');
  if (scratchPad.investigations.length === 0) {
    lines.push('_None_');
  } else {
    lines.push(...scratchPad.investigations.map(note => `- ${note}`));
  }
  lines.push('');

  lines.push('## Notes', '');
  if (scratchPad.notes.length === 0) {
    lines.push('_None_');
  } else {
    lines.push(...scratchPad.notes.map(note => `- ${note}`));
  }
  lines.push('');

  lines.push('## Definition Of Done', '', scratchPad.dodDraft ?? '_None_', '');
  return lines.join('\n');
}

function detectTokenizerLedger(): string | undefined {
  const candidates = [
    process.env.TOKENIZER_LEDGER_PATH,
    path.join(process.cwd(), 'tokenizer_ledger.db'),
    path.join(process.cwd(), '.ai-vision', 'tokenizer_ledger.db'),
  ].filter(Boolean) as string[];

  return candidates.find(candidate => fs.existsSync(candidate));
}

function buildStory(
  definition: WorkflowDefinition,
  sessionId: string,
  startedAt: number,
  result: WorkflowResult,
  session: ShortTermSession | null,
): Story {
  const totalAgentSteps = shortTermMemory.getTotalAgentSteps();

  const outcome: Story['outcome'] = result.success
    ? 'success'
    : result.stepResults.some(s => s.success)
    ? 'partial'
    : 'failure';

  const completedFields = shortTermMemory.getAllCompletedFields();
  const fieldCount = completedFields.length;
  const stepCount = result.stepResults.filter(s => s.success).length;
  const durSec = (result.durationMs / 1000).toFixed(1);
  const bespoke = session?.isBespoke ? ' Bespoke investigation path was used.' : '';

  const summary =
    `Workflow "${definition.name}" ran for ${durSec}s completing ` +
    `${stepCount}/${definition.steps.length} steps. ` +
    (fieldCount > 0
      ? `${fieldCount} form fields were confirmed filled.`
      : 'No structured field confirmations were recorded.') +
    bespoke +
    (result.error ? ` Run ended with error: ${result.error}` : '');

  const scratchNotes = session?.scratchPad.notes ?? [];
  const notes = shortTermMemory.getAllNotes();
  const lessonsLearned = [...notes, ...scratchNotes];
  const resolvedLessons = lessonsLearned.length > 0
    ? lessonsLearned
    : result.success
    ? ['Workflow completed without notable issues.']
    : [`Workflow failed at step: ${result.stepResults.slice(-1)[0]?.stepId ?? 'unknown'}`];

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
    lessonsLearned: resolvedLessons,
    improvements,
    metrics: {
      totalWorkflowSteps: definition.steps.length,
      totalAgentSteps: totalAgentSteps || result.stepResults.length,
      durationMs: result.durationMs,
    },
  };
}

function buildSicTrigger(
  definition: WorkflowDefinition,
  sessionId: string,
  finalState: SessionState | null,
  session: ShortTermSession | null,
): SicTrigger | undefined {
  const failureReason = finalState?.hitlFailureReason?.trim();
  const hitlComments = finalState?.hitlComments?.trim();
  if (!finalState?.hitlDod && !hitlComments && !failureReason) return undefined;

  const selfHealInstruction = failureReason
    ? 'Investigate why the final visible success state was missing, update the workflow to verify success evidence before human confirmation, and preserve the HITL rejection reason as a reusable improvement.'
    : undefined;

  return {
    sessionId,
    workflowId: definition.id,
    workflowName: definition.name,
    currentUrl:
      finalState?.currentUrl ??
      session?.steps[session.steps.length - 1]?.currentUrl ??
      '',
    triggerType: failureReason ? 'failure' : 'qa',
    definitionOfDone: finalState?.hitlDod,
    hitlComments,
    failureReason,
    failedStepId: finalState?.hitlFailureStepId,
    selfHealInstruction,
    nextStepReasoning:
      session?.scratchPad.plan ??
      session?.scratchPad.notes.slice(-1)[0] ??
      undefined,
    createdAt: new Date().toISOString(),
  };
}

function deriveMetadataRecords(
  definition: WorkflowDefinition,
  session: ShortTermSession | null,
  result: WorkflowResult,
): TaskMetadataRecord[] {
  const urls = new Set<string>();
  for (const step of definition.steps) {
    if (step.type === 'navigate') urls.add(step.url);
  }
  for (const step of session?.steps ?? []) {
    if (step.currentUrl) urls.add(step.currentUrl);
  }

  const stepIds = definition.steps.map(step => step.id);
  const transitSteps = (session?.steps ?? []).map(step => step.stepId);

  return Array.from(urls)
    .map(urlText => safeDomain(urlText))
    .filter(Boolean)
    .map(domain => ({
      workflowId: definition.id,
      workflowName: definition.name,
      domain,
      stepIds,
      transitSteps,
      successCount: result.success ? 1 : 0,
      lastSeen: new Date().toISOString(),
    }));
}

export async function wrapUpWorkflowRun(input: WrapUpInput): Promise<{
  story: Story;
  sicTrigger?: SicTrigger;
}> {
  ensureDirs();
  telemetry.emit({
    source: 'wrapup',
    name: 'wrapup.started',
    sessionId: input.sessionId,
    workflowId: input.definition.id,
    details: {
      workflowName: input.definition.name,
      success: input.result.success,
    },
  });

  if (input.finalState?.hitlDod) {
    shortTermMemory.setScratchDodDraft(input.finalState.hitlDod);
  }
  if (input.finalState?.hitlComments) {
    shortTermMemory.addScratchNote(`HITL QA: ${input.finalState.hitlComments}`);
  }
  if (input.finalState?.hitlFailureReason) {
    shortTermMemory.addScratchNote(
      `HITL final-step failure: ${input.finalState.hitlFailureReason}`,
    );
  }

  const session = shortTermMemory.getSession();
  const story = buildStory(
    input.definition,
    input.sessionId,
    input.startedAt,
    input.result,
    session,
  );
  const scratchPadMarkdown = renderScratchPadMarkdown(session?.scratchPad ?? null);
  const sicTrigger = buildSicTrigger(input.definition, input.sessionId, input.finalState, session);
  const tokenizerLedgerPath = detectTokenizerLedger();

  longTermMemory.writeStory(story);

  const artifact: WrapUpArtifact = {
    sessionId: input.sessionId,
    workflowId: input.definition.id,
    result: input.result,
    shortTerm: session,
    finalState: input.finalState,
    tokenizerLedgerPath,
    sicTrigger,
    storyId: story.id,
    wrappedAt: new Date().toISOString(),
  };

  const repo = new SessionRepository();
  repo.saveWorkflowRun({
    sessionId: input.sessionId,
    workflowId: input.definition.id,
    workflowName: input.definition.name,
    success: input.result.success,
    resultJson: JSON.stringify(input.result),
    stateJson: input.finalState ? JSON.stringify(input.finalState) : undefined,
    shortTermJson: session ? JSON.stringify(session) : undefined,
    scratchPadMarkdown,
    sicTriggerJson: sicTrigger ? JSON.stringify(sicTrigger) : undefined,
  });

  const metadataRecords = deriveMetadataRecords(input.definition, session, input.result);
  for (const record of metadataRecords) {
    taskMetadata.upsert(record);
    repo.saveTaskMetadata(record);
  }

  fs.writeFileSync(
    path.join(wrapUpsDir(), `${input.sessionId}.json`),
    JSON.stringify(artifact, null, 2),
    'utf8',
  );

  if (sicTrigger) {
    fs.writeFileSync(
      path.join(sicTriggersDir(), `${input.sessionId}.json`),
      JSON.stringify(sicTrigger, null, 2),
      'utf8',
    );
  }

  shortTermMemory.clearSensitiveData();
  shortTermMemory.reset();

  telemetry.emit({
    source: 'wrapup',
    name: 'wrapup.completed',
    sessionId: input.sessionId,
    workflowId: input.definition.id,
    details: {
      storyId: story.id,
      hasSicTrigger: Boolean(sicTrigger),
      tokenizerLedgerDetected: Boolean(tokenizerLedgerPath),
      metadataRecords: metadataRecords.length,
    },
  });

  return { story, sicTrigger };
}
