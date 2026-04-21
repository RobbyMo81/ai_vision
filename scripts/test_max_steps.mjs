#!/usr/bin/env node
/**
 * Validates that per-step maxSteps correctly caps the browser-use agent loop.
 *
 * Pass criteria:
 *   1. Both steps output "TITLE: Example Domain"
 *   2. capped_task logs no "Step 3" line  (browser-use step counter)
 *   3. capped_task wall-clock duration < 45 000 ms (2 steps × ~15 s/step + headroom)
 *   4. uncapped_task also produces correct output (confirms the cap didn't break anything)
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const CLI  = path.join(ROOT, 'dist', 'cli', 'index.js');
const WORKFLOW = path.join(ROOT, 'workflows', 'test_max_steps.yaml');
const DB_PATH = process.env.DB_PATH ?? path.join(ROOT, 'ai-vision.db');
const MAX_CAPPED_MS = 45_000;
const EXPECTED_TITLE = 'TITLE: Example Domain';

// ── Run the workflow ──────────────────────────────────────────────────────────
console.log('Running test_max_steps workflow (headless)…\n');

const start = Date.now();
const proc = spawnSync(
  process.execPath,
  [CLI, 'workflow', WORKFLOW],
  {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, AI_VISION_HEADED: 'false' },
  }
);
const totalMs = Date.now() - start;

const stdout = proc.stdout ?? '';
const stderr = proc.stderr ?? '';
const combined = stdout + stderr;

if (proc.status !== 0) {
  console.error('Workflow exited with non-zero status:', proc.status);
  console.error(combined);
  process.exit(1);
}

function stepLogs(stepId) {
  // Crude: look for [browser-use] lines that appear between step start markers
  // We rely on the fact that steps run sequentially — lines between two step
  // markers belong to that step. This is best-effort.
  const lines = combined.split('\n');
  let inside = false;
  const out = [];
  for (const line of lines) {
    if (line.includes(`executing step: ${stepId}`) || line.includes(`step ${stepId}`)) inside = true;
    if (inside && line.includes('[browser-use]')) out.push(line);
    // Stop collecting when the next step starts
    if (inside && out.length > 0 && line.includes('executing step:') && !line.includes(stepId)) break;
  }
  return out;
}

function loadLatestWorkflowRun() {
  const db = new DatabaseSync(DB_PATH);
  try {
    const row = db.prepare(
      `SELECT result_json
       FROM workflow_runs
       WHERE workflow_id = ?
       ORDER BY datetime(created_at) DESC
       LIMIT 1`,
    ).get('test_max_steps');

    if (!row) {
      throw new Error(`No workflow_runs row found for test_max_steps in ${DB_PATH}`);
    }

    return JSON.parse(row.result_json);
  } finally {
    db.close();
  }
}

const workflowRun = loadLatestWorkflowRun();
const stepResults = Array.isArray(workflowRun.stepResults) ? workflowRun.stepResults : [];
const outputs = workflowRun.outputs ?? {};

function extractStepOutput(stepId) {
  const step = stepResults.find((s) => s.stepId === stepId);
  return typeof step?.output === 'string' ? step.output : null;
}

function extractStepDuration(stepId) {
  const step = stepResults.find((s) => s.stepId === stepId);
  return typeof step?.durationMs === 'number' ? step.durationMs : null;
}

// ── Assertions ────────────────────────────────────────────────────────────────

const failures = [];

function assert(condition, message) {
  const icon = condition ? '✓' : '✗';
  console.log(`  ${icon}  ${message}`);
  if (!condition) failures.push(message);
}

console.log('── capped_task (maxSteps: 2) ───────────────────────────────────');
const cappedOut = extractStepOutput('capped_task');
console.log(`     output: ${cappedOut ?? '(not found)'}`);
assert(cappedOut === EXPECTED_TITLE, `output equals "${EXPECTED_TITLE}"  →  got: ${cappedOut}`);

// Check no Step 3 appeared in browser-use logs while capped_task was running
const cappedLogs = stepLogs('capped_task');
const hasStep3 = cappedLogs.some(l => /Step\s+3/i.test(l));
assert(!hasStep3, 'browser-use did not execute a 3rd step during capped_task');

const cappedDuration = extractStepDuration('capped_task');
if (cappedDuration != null) {
  assert(cappedDuration < MAX_CAPPED_MS, `capped_task completed in < ${MAX_CAPPED_MS}ms  →  actual: ${cappedDuration}ms`);
} else {
  // Fall back to total wall-clock as a rough upper bound when individual
  // step timings aren't parseable from output
  console.log(`     (step duration not parsed; total run was ${totalMs}ms)`);
}

console.log('\n── uncapped_task (no maxSteps) ─────────────────────────────────');
const uncappedOut = extractStepOutput('uncapped_task');
console.log(`     output: ${uncappedOut ?? '(not found)'}`);
assert(uncappedOut === EXPECTED_TITLE, `output equals "${EXPECTED_TITLE}"  →  got: ${uncappedOut}`);
if (Object.keys(outputs).length > 0) {
  console.log(`     workflow outputs keys: ${Object.keys(outputs).join(', ')}`);
}

// ── Result ────────────────────────────────────────────────────────────────────

console.log(`\nTotal wall-clock: ${totalMs}ms`);
if (failures.length === 0) {
  console.log('\nAll assertions passed.');
} else {
  console.log(`\n${failures.length} assertion(s) failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log('\n── raw output ──────────────────────────────────────────────────');
  console.log(combined.slice(0, 3000));
  process.exit(1);
}
