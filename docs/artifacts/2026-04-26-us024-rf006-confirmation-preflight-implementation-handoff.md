# Direct Workflow Gate Layer — Phase 2: Final-Step Confirmation Pre-Flight Binding Enforcement — Implementation Handoff

Story: `US-024`
Tracker Row: `RF-006`
Source Storyline: `docs/artifacts/2026-04-26-us024-rf006-confirmation-preflight-storyline.md`
Source Story Card: `docs/artifacts/2026-04-26-us024-rf006-confirmation-preflight-forge-story.yaml`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the storyline, YAML story card, and investigation requirements artifact before writing code.
2. Read the existing instrumentation in `src/ui/server.ts` — the attribution fields are already
   captured; this story adds enforcement gates on top of them, it does not redesign the instrumentation.
3. Treat this as Phase 2 of the direct gate layer: enforcement only on `/api/confirm-final-step`,
   trace parity only on `/api/return-control`. Do not widen into a general endpoint audit.
4. Do not implement caller-allowlist enforcement for non-UI callers with empty `resolvedClientId`
   — that path needs a separate design story.
5. Do not remove `mode: agentic`.
6. Write back tracker, progress, Forge memory, and tests for the next agent.

## Task

Implement Phase 2 pre-flight binding enforcement in `ai-vision`.

The implementation must:

1. Add three sequential pre-flight gate blocks at the top of the `POST /api/confirm-final-step`
   handler in `src/ui/server.ts`, before any call to `hitlCoordinator`:

   **Gate 1 — Run-phase gate**
   - Check `workflowEngine.currentState?.phase === 'hitl_qa'`
   - If false: emit `ui.hitl.confirm_final_step.rejected` with `gate: 'run_phase_gate'`, respond
     HTTP 409 `{ error: 'No active final confirmation in progress' }`
   - Return early without proceeding

   **Gate 2 — Session binding gate**
   - Extract `requestSessionId` from the parsed request body (already present in the existing handler)
   - If `requestSessionId` is non-empty AND `requestSessionId !== workflowEngine.currentState?.id`:
     emit `ui.hitl.confirm_final_step.rejected` with `gate: 'session_binding_gate'`, respond
     HTTP 400 `{ error: 'Session ID mismatch' }`
   - Return early without proceeding

   **Gate 3 — WebSocket presence gate**
   - `resolvedClientId` is already computed in the handler (from body `clientId` or `X-AiVision-Client-Id` header)
   - If `resolvedClientId` is non-empty AND `socketsForPage(resolvedClientId).size === 0`:
     emit `ui.hitl.confirm_final_step.rejected` with `gate: 'websocket_presence_gate'`, respond
     HTTP 403 `{ error: 'No active UI session for this client' }`
   - Return early without proceeding

2. Create a handler-scoped named const `emitConfirmationRejection` immediately after the existing
   `/api/confirm-final-step` attribution values are computed (`current`, `requestSessionId`,
   `requestClientId`, `headerClientId`, `clientId`, `requestRunBinding`, `matchingSocketIds`).
   This closes the helper-shape decision gate: do not use one-off inline emitters inside each
   gate branch, and do not lift the helper outside the handler because it depends on request-local
   body/header/caller metadata. The const emits `ui.hitl.confirm_final_step.rejected` with:
   - `gate` (string)
   - `reason` (string matching error message)
   - `requestSessionId`, `activeSessionId`
   - `resolvedClientId`, `matchingWsClientCount`
   - full `callerMetadata()` result
   - `wsConnectionCount`

3. Add caller-attribution trace instrumentation to `POST /api/return-control`:
   - call `callerMetadata(request)` at handler entry
   - resolve `pageClientId` from body or header (same pattern as `/api/confirm-final-step`)
   - resolve `matchingWsClientIds` and `matchingWsClientCount` via `socketsForPage`
   - emit `ui.hitl.return_control.received` with those fields (trace only — no gate enforcement)

## Required Code Surfaces

1. [`src/ui/server.ts`](/home/spoq/ai-vision/src/ui/server.ts) — primary implementation target
2. [`src/telemetry/types.ts`](/home/spoq/ai-vision/src/telemetry/types.ts) — add `ui.hitl.confirm_final_step.rejected` and `ui.hitl.return_control.received` event names if not already present as loose string events

## Key Existing Symbols To Reuse

All of these already exist in `src/ui/server.ts` and must be reused as-is:

| Symbol | Purpose |
|---|---|
| `callerMetadata(req)` | Returns object with `remoteAddress`, `userAgent`, `origin`, `referer`, `host`, `xForwardedFor`, `method`, `path` |
| `socketsForPage(pageClientId)` | Returns `Set<string>` of `wsClientId`s for the given page-local client ID |
| `parseClientId(req)` | Parses `X-AiVision-Client-Id` header |
| `headerValue(req, name)` | Case-insensitive header reader |
| `wsConnectionCount` | Live WebSocket connection counter |
| `workflowEngine` | Imported singleton; `.currentState` is the canonical run state |

## Acceptance Criteria

- Run-phase gate rejects with HTTP 409 when `workflowEngine.currentState.phase !== 'hitl_qa'`
- Session binding gate rejects with HTTP 400 when `requestSessionId` is present and mismatches
  the active session ID
- WebSocket presence gate rejects with HTTP 403 when `resolvedClientId` is non-empty and
  `socketsForPage(resolvedClientId).size === 0`
- Each rejected gate emits `ui.hitl.confirm_final_step.rejected` with the gate name and full
  attribution fields
- Active-tab happy path (all gates pass) still succeeds end-to-end
- `/api/return-control` emits `ui.hitl.return_control.received` with caller attribution (trace only)
- `pnpm run typecheck` passes
- `pnpm test` passes

## Implementation Notes

- Keep each gate block self-contained (check → emit → return). Do not merge gate logic.
- The existing `ui.hitl.confirm_final_step.received` and `ui.hitl.confirm_final_step.completed`
  events must remain unchanged — the rejection event is an additional emitter, not a replacement.
- Do not touch the `hitlCoordinator.confirmCompletion` call path; gates must return
  before reaching it on rejection.
- For non-UI callers (empty `resolvedClientId`): let them through in this story. The allowlist
  enforcement for that path is deferred.
- Test the rejection paths with lightweight integration tests using the existing `http.createServer`
  test pattern; avoid full engine mocking unless needed for the run-phase gate test.
