# Return-Control Pre-Flight Binding Enforcement — Implementation Handoff

Story: `US-025`
Tracker Row: `RF-007`
Source Storyline: `docs/artifacts/2026-04-26-us025-rf007-return-control-binding-storyline.md`
Source Story Card: `docs/artifacts/2026-04-26-us025-rf007-return-control-binding-forge-story.yaml`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the storyline, YAML story card, definition of done, and HITL gate quick reference before code changes.
2. Read the current `POST /api/return-control` and `POST /api/confirm-final-step` handlers in `src/ui/server.ts`.
3. Reuse the US-024 attribution pattern. Do not redesign the telemetry shape.
4. Keep this story focused on `/api/return-control`.
5. Preserve `mode: agentic`.
6. Record the Summary of Work in `progress.txt`, then update PRD, tracker, and the Forge history archive only after validation passes.
7. Do not append long-form story history to `AGENTS.md`; append the story narrative to `docs/history/forge_history.md` and one library-card row to `docs/history/history_index.md`.

## Task

Implement return-control pre-flight binding enforcement in `ai-vision`.

The implementation must:

1. Update the browser UI `returnControl()` function in `src/ui/server.ts`:
   - create `requestId` with `nextRequestId()`
   - send `POST /api/return-control` with `Content-Type: application/json`
   - send header `X-AiVision-Client-Id: pageClientId`
   - send body fields:
     - `sessionId: currentSessionId`
     - `requestId`
     - `clientId: pageClientId`

2. In the `POST /api/return-control` handler, parse body fields:
   - `sessionId`
   - `requestId`
   - `clientId`

3. Compute these request-local values before telemetry and gate checks:
   - `current = workflowEngine.currentState`
   - `requestSessionId`
   - `requestClientId`
   - `headerClientId`
   - `resolvedClientId`
   - `requestRunBinding`
   - `matchingSocketIds = socketsForPage(resolvedClientId)`
   - `caller = callerMetadata(req)`

4. Keep `ui.hitl.return_control.received`.
   - Include all request/session/client/socket/caller fields.
   - Include `currentPhase`, `currentHitlAction`, and `currentStep`.

5. Create one handler-scoped named const `emitReturnControlRejection` immediately after the request-local values are computed.
   - Do not use one-off inline emitters inside each gate branch.
   - Do not lift the helper outside the handler.
   - Emit `ui.hitl.return_control.rejected`.
   - Include:
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
     - caller metadata fields

6. Add three sequential gate blocks before `hitlCoordinator.returnControl()`:

   **Gate 1 — Return-control action gate**
   - Allow exactly these active state pairs:
     - `phase === 'awaiting_human'` and `hitlAction === 'return_control'`
     - `phase === 'awaiting_human'` and `hitlAction === 'verify_authentication'`
     - `phase === 'hitl_qa'` and `hitlAction === 'approve_draft'`
     - `phase === 'hitl_qa'` and `hitlAction === 'capture_notes'`
   - Reject HTTP `409` with `{ error: 'No active return-control wait in progress' }`
   - Emit rejection with `gate: 'return_control_action_gate'`
   - Return early.

   **Gate 2 — Session binding gate**
   - If `requestSessionId` is non-empty and does not match `current?.id`, reject HTTP `400`.
   - Response: `{ error: 'Session ID mismatch' }`
   - Emit rejection with `gate: 'session_binding_gate'`
   - Return early.

   **Gate 3 — WebSocket presence gate**
   - If `resolvedClientId` is non-empty and `matchingSocketIds.length === 0`, reject HTTP `403`.
   - Response: `{ error: 'No active UI session for this client' }`
   - Emit rejection with `gate: 'websocket_presence_gate'`
   - Return early.

7. After a successful `hitlCoordinator.returnControl()`, emit `ui.hitl.return_control.completed`.
   - Include the same attribution fields used by `received`.

## Required Code Surfaces

1. [`src/ui/server.ts`](/home/spoq/ai-vision/src/ui/server.ts) — implementation target
2. [`src/ui/server.test.ts`](/home/spoq/ai-vision/src/ui/server.test.ts) — integration regression tests

## Required Tests

- invalid phase/action returns HTTP `409` and emits `return_control_action_gate`
- session mismatch returns HTTP `400` and emits `session_binding_gate`
- stale client returns HTTP `403` and emits `websocket_presence_gate`
- `awaiting_human:return_control` resumes successfully
- `awaiting_human:verify_authentication` resumes successfully
- `hitl_qa:approve_draft` resumes successfully
- `hitl_qa:capture_notes` resumes successfully
- successful resume emits `ui.hitl.return_control.completed`
- non-UI empty `resolvedClientId` behavior remains unchanged in this story

## Acceptance Criteria

- `POST /api/return-control` rejects invalid return-control phase/action with HTTP `409`.
- `POST /api/return-control` rejects session mismatch with HTTP `400`.
- `POST /api/return-control` rejects stale page client with HTTP `403`.
- Every rejection emits `ui.hitl.return_control.rejected` with the gate name and full attribution fields.
- Active-tab happy paths still reach `hitlCoordinator.returnControl()`.
- Browser UI sends `sessionId`, `requestId`, `clientId`, and `X-AiVision-Client-Id`.
- `ui.hitl.return_control.completed` fires on successful resume.
- `pnpm run typecheck` passes.
- `pnpm test` passes.

## Implementation Notes

- Keep each gate block self-contained: check, emit, respond, return.
- Preserve `ui.hitl.return_control.received`.
- Match US-024 naming and field shape as closely as possible.
- Do not block empty-client non-UI callers in this story.
- Do not modify `/api/confirm-final-step`.
- Do not remove `mode: agentic`.
