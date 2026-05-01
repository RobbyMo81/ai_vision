# Direct Workflow Gate Layer — Phase 2: Final-Step Confirmation Pre-Flight Binding Enforcement

Story: `US-024`
Tracker Row: `RF-006`
Date: `2026-04-26`

## Problem

`US-023` made the direct engine publish every HITL wait and terminal transition through one canonical
state path. That closes the visibility gap but leaves the enforcement gap open:

- `/api/confirm-final-step` accepts a `confirmed: true` body from any HTTP caller regardless of
  whether the request originates from the active run's UI page
- A stale-tab POST (page-local client ID present but its WebSocket has already disconnected) is
  indistinguishable from a legitimate active-tab POST at the enforcement layer
- A non-UI caller (no client identity at all) currently succeeds if the session happens to be in
  `hitl_qa` phase
- `/api/return-control` has no caller attribution at all — the live `post_to_reddit` run on
  2026-04-26 showed the `review_reddit_draft` step resume without supervisor action

These gaps allow the most consequential workflow action — final-step confirmation — to be triggered
without strong evidence that it came from the operator's active browser session.

The instrumentation added in the prior investigation pass already captures the attribution fields
needed to enforce these checks:

- `resolvedClientId` (page-local client ID from request body or header)
- `matchingWsClientIds` / `matchingWsClientCount` (active WebSocket connections for that client)
- `requestSessionId` vs `activeSessionId` (run binding)

The evidence from `downloads/live-repro-matrix-evidence.json` confirms the three attribution
scenarios are reliably distinguishable at request time.

## Why This Story Exists

Every later gate-layer story (approval enforcement, side-effect blocking) assumes that the final
confirmation surface is already tightly bound to the active operator session. Without pre-flight
enforcement on `/api/confirm-final-step` those gates have a soft perimeter.

This story exists to implement Phase 2 of the direct gate layer:

- pre-flight run-phase binding on `/api/confirm-final-step`
- pre-flight session binding on `/api/confirm-final-step`
- pre-flight WebSocket presence check on `/api/confirm-final-step`
- structured rejection telemetry for every failed pre-flight gate
- equivalent trace attribution on `/api/return-control` (instrumentation parity, not enforcement)

## Scope

This story is implementation, but narrow implementation.

It must:

- add three pre-flight gates to `/api/confirm-final-step` in `src/ui/server.ts`:
  1. **Run-phase gate** — reject (HTTP 409) if `workflowEngine.currentState.phase !== 'hitl_qa'`
  2. **Session binding gate** — reject (HTTP 400) if `requestSessionId` is present and does not
     match `workflowEngine.currentState.id`
  3. **WebSocket presence gate** — reject (HTTP 403) if `resolvedClientId` is non-empty and
     `matchingWsClientCount === 0` (stale-tab path)
- emit a `ui.hitl.confirm_final_step.rejected` telemetry event for each rejected pre-flight gate
  with the gate name, reject reason, and full caller attribution fields already captured by
  the existing instrumentation
- implement rejection telemetry through one handler-scoped named const `emitConfirmationRejection`
  immediately after the existing `/api/confirm-final-step` attribution values are computed; do not
  use one-off inline emitters inside each gate branch and do not lift the helper outside the handler
- add equivalent caller-attribution trace instrumentation to `/api/return-control` (same pass that
  was applied to `/api/confirm-final-step` in the prior investigation — trace only, no enforcement
  in this story)
- add regression tests for all three rejection paths
- preserve existing passing paths untouched
- preserve `mode: agentic`

It must not:

- enforce caller identity for non-UI callers with no `resolvedClientId` (that path needs
  a separate caller-allowlist design story)
- add enforcement to `/api/return-control` (trace parity only in this story)
- change how `hitlCoordinator` owns the blocking wait
- remove or rename the existing instrumentation fields

## Source Evidence

- `downloads/live-repro-evidence.json` — single-run attribution capture
- `downloads/live-repro-matrix-evidence.json` — three-scenario attribution matrix
- `docs/debriefs/2026-04-25-confirm-final-step-trace-and-preflight-requirements.md`
- `docs/artifacts/2026-04-24-direct-workflow-gate-layer-design.md`
- `src/ui/server.ts` — existing instrumentation (Pass 1 + Pass 2 from investigation)
- `src/workflow/engine.ts` — `workflowEngine.currentState` (canonical run state)

## Outcome Required

At the end of this story:

- stale-tab and session-mismatched confirmation requests are rejected before reaching
  `hitlCoordinator.confirmCompletion`
- every rejection emits a structured `ui.hitl.confirm_final_step.rejected` telemetry event
- `/api/return-control` exposes the same caller attribution fields in telemetry that
  `/api/confirm-final-step` already captures
- regression tests prove the three rejection gates and leave the active-tab happy-path intact
