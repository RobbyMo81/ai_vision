# Return-Control Pre-Flight Binding Enforcement

Story: `US-025`
Tracker Row: `RF-007`
Date: `2026-04-26`

## Problem

`US-024` hardened `POST /api/confirm-final-step` with run-phase, session-binding, and live WebSocket presence gates. It also added caller-attribution telemetry to `POST /api/return-control`, but it deliberately left return-control enforcement out of scope.

That leaves one active HITL resume surface soft:

- `POST /api/return-control` emits `ui.hitl.return_control.received`
- then it calls `hitlCoordinator.returnControl()`
- it does not yet reject stale tabs, mismatched sessions, invalid phases, mismatched HITL actions, and unbound UI clients

The live Reddit run showed a draft-review step resume without the supervising agent sending the resume action. The next safe step is to make the return-control endpoint enforce the same active-run and active-client binding model already proven on final confirmation.

## Why This Story Exists

Return-control is the generic resume endpoint for normal HITL waits:

- manual takeover
- authentication verification
- draft approval
- failed-run closeout

Those waits can unblock browser side effects. They need deterministic endpoint binding before the direct workflow engine can safely move into approval gates, content gates, and browser postcondition gates.

## Scope

This story is a narrow implementation story.

It must:

- update the browser UI `returnControl()` request to send:
  - `Content-Type: application/json`
  - `X-AiVision-Client-Id`
  - body fields `sessionId`, `requestId`, and `clientId`
- add three sequential pre-flight gates to `POST /api/return-control` in `src/ui/server.ts` before `hitlCoordinator.returnControl()`:
  1. **Return-control action gate** — reject HTTP `409` unless the active state is one of the allowed return-control wait pairs:
     - `phase === 'awaiting_human'` with `hitlAction === 'return_control'`
     - `phase === 'awaiting_human'` with `hitlAction === 'verify_authentication'`
     - `phase === 'hitl_qa'` with `hitlAction === 'approve_draft'`
     - `phase === 'hitl_qa'` with `hitlAction === 'capture_notes'`
  2. **Session binding gate** — reject HTTP `400` when `requestSessionId` is present and does not match `workflowEngine.currentState.id`
  3. **WebSocket presence gate** — reject HTTP `403` when `resolvedClientId` is non-empty and `matchingWsClientCount === 0`
- emit `ui.hitl.return_control.rejected` for every rejected gate with:
  - `gate`
  - `reason`
  - `requestId`
  - `requestSessionId`
  - `activeSessionId`
  - `requestRunBinding`
  - `requestClientId`
  - `headerClientId`
  - `resolvedClientId`
  - `matchingWsClientIds`
  - `matchingWsClientCount`
  - `currentPhase`
  - `currentHitlAction`
  - `currentStep`
  - `wsConnectionCount`
  - full `callerMetadata(req)` fields
- keep the existing `ui.hitl.return_control.received` event
- add `ui.hitl.return_control.completed` after successful resume
- add regression tests for all rejection paths and active wait-pair happy paths
- preserve `mode: agentic`

It must not:

- add enforcement to `/api/confirm-final-step`
- change `hitlCoordinator` wait ownership
- block empty-client non-UI callers in this story
- change direct workflow gate behavior outside the return-control endpoint

## Source Evidence

- `docs/debriefs/2026-04-26-hitl-gate-story-reference.md`
- `docs/debriefs/2026-04-25-confirm-final-step-trace-and-preflight-requirements.md`
- `docs/debriefs/2026-04-26-live-confirmation-attribution-test.md`
- `src/ui/server.ts`
- `src/session/hitl.ts`
- `src/session/types.ts`
- `src/workflow/engine.ts`

## Outcome Required

At the end of this story:

- stale-tab return-control requests cannot resume a HITL wait
- session-mismatched return-control requests cannot resume a HITL wait
- invalid-phase and wrong-HITL-action requests cannot resume a HITL wait
- every rejection emits structured telemetry
- valid active-tab return-control requests still resume expected waits
- typecheck and test gates pass
