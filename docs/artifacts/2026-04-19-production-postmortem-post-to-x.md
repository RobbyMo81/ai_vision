# Production Postmortem - Post To X

Date: 2026-04-19
Workflow: post_to_x
Session: c7734719-6400-470e-a2a4-03029c07f493
Source of evidence: ai-vision.db (workflow_runs, telemetry_events)

## Executive Summary

The workflow did produce failure information at the agent step level, but the top-level workflow error string lost detail because error propagation relied on `taskResult.error` and ignored `taskResult.output` when `error` was absent.

Primary failure cause was external provider quota exhaustion:
- OpenAI API returned 429 `insufficient_quota` during `check_duplicate_post`.

Secondary issue was internal observability quality:
- Final workflow error became `Step 'check_duplicate_post' failed: undefined`.

## Timeline (UTC)

- 22:58:22.590 - `workflow.run.started`
- 22:58:23.605 - `workflow.preflight.completed`
- 22:58:23.606 - `workflow.content.bootstrap.skipped` (message already provided)
- 22:58:23.608 - `open_x` started
- 22:58:24.878 - `open_x` finished success
- 22:58:24.890 - `x_login` started
- 22:58:25.733 - `workflow.hitl_takeover.auth_verification_satisfied`
- 22:58:25.744 - `x_login` finished success
- 22:58:25.747 - `check_duplicate_post` started
- 22:58:25.748 - `workflow.agent_task.routed`
- 23:00:07.200 - `check_duplicate_post` finished failure
- 23:02:46.200 - `workflow.run.failed`

## Root Cause

1. External dependency failure
- OpenAI request failed with: `Error code: 429`, `type: insufficient_quota`.
- Impact: `check_duplicate_post` agent task could not execute.

2. Internal error propagation defect
- Bridge failure payload used `output` but not always `error`.
- Workflow engine used only `taskResult.error` in final failure message.
- Resulting top-level error lost actionable details (`undefined`).

## Confirmed Evidence

From `workflow_runs.result_json`:
- Failed step: `check_duplicate_post`
- Failed output includes OpenAI 429 insufficient_quota payload
- Top-level error string: `Step 'check_duplicate_post' failed: undefined`

From `telemetry_events`:
- Terminal event: `workflow.run.failed`
- details_json: `{ "success": false, "error": "Step 'check_duplicate_post' failed: undefined", "socialPublishOutcome": "unknown_publish_failure" }`

## Immediate Corrective Action Applied

Patched workflow engine error propagation:
- In `agent_task` return path, if `taskResult.error` is missing and `success=false`, use `taskResult.output` as fallback error text.

File updated:
- `src/workflow/engine.ts`

## SIC-Ready Edge Cases

SIC-CAND-EP-001 - Provider quota exhaustion during pre-publish checks
- Pattern: social publishing prechecks fail with provider quota/rate-limit and block run.
- Trigger evidence: session `c7734719-6400-470e-a2a4-03029c07f493`.
- Proposed instruction: On quota/rate-limit/auth provider failures, perform provider failover if available; otherwise emit explicit operator action guidance and classify as dependency outage.

SIC-CAND-EP-002 - Lost root-cause text in workflow failure summaries
- Pattern: failed agent task contains actionable output error but final workflow error is undefined.
- Trigger evidence: top-level run error string lacked provider details.
- Proposed instruction: Always derive terminal step error from `error || output || generic` and preserve provider/model metadata in failure payloads.

## Recommended Next Changes

1. Add provider/model fields to TypeScript `TaskResult` and persist in telemetry for every agent task.
2. Add a dedicated social outcome class for dependency failures (for example, `llm_provider_unavailable`).
3. Add regression test for error fallback path when `taskResult.error` is undefined.
4. Add runbook logic in UI/CLI output: if quota error detected, show exact remediation checklist.
