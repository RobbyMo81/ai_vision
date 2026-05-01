# Return-Control Pre-Flight Binding Enforcement — Definition Of Done

Story: `US-025`
Tracker Row: `RF-007`

The story is done only when all of the following are true:

1. Browser UI request binding is implemented:
   - `returnControl()` sends `Content-Type: application/json`
   - `returnControl()` sends `X-AiVision-Client-Id`
   - request body includes `sessionId`, `requestId`, and `clientId`

2. Three pre-flight gates exist in the `POST /api/return-control` handler in `src/ui/server.ts`, evaluated before `hitlCoordinator.returnControl()`:
   - **Gate 1 — Return-control action gate** rejects HTTP `409` unless the active state is one of:
     - `awaiting_human:return_control`
     - `awaiting_human:verify_authentication`
     - `hitl_qa:approve_draft`
     - `hitl_qa:capture_notes`
   - **Gate 2 — Session binding gate** rejects HTTP `400` when `requestSessionId` is present and does not match `workflowEngine.currentState.id`
   - **Gate 3 — WebSocket presence gate** rejects HTTP `403` when `resolvedClientId` is non-empty and `socketsForPage(resolvedClientId).length === 0`

3. Every rejected pre-flight gate emits `ui.hitl.return_control.rejected` with:
   - `gate`
   - `reason`
   - `requestId`
   - `requestSessionId`, `activeSessionId`, `requestRunBinding`
   - `requestClientId`, `headerClientId`, `resolvedClientId`
   - `matchingWsClientIds`, `matchingWsClientCount`
   - `currentPhase`, `currentHitlAction`, `currentStep`
   - `wsConnectionCount`
   - full caller attribution metadata

4. The rejection event is emitted through one handler-scoped named const `emitReturnControlRejection` placed immediately after request-local attribution values are computed.

5. The active-tab happy paths are unaffected:
   - `awaiting_human:return_control` reaches `hitlCoordinator.returnControl()`
   - `awaiting_human:verify_authentication` reaches `hitlCoordinator.returnControl()`
   - `hitl_qa:approve_draft` reaches `hitlCoordinator.returnControl()`
   - `hitl_qa:capture_notes` reaches `hitlCoordinator.returnControl()`

6. Successful resume emits `ui.hitl.return_control.completed` with attribution fields matching `ui.hitl.return_control.received`.

7. Empty-client non-UI callers are not blocked in this story.

8. Regression tests cover:
   - Gate 1 rejection
   - Gate 2 rejection
   - Gate 3 rejection
   - all four active wait-pair happy paths
   - rejection telemetry for every rejection path
   - completed telemetry for successful resume
   - UI request binding fields

9. Quality gates:
   - `pnpm run typecheck` exits `0`
   - `pnpm test` exits `0`

10. Forge evidence trail:
   - storyline artifact exists
   - YAML story card exists
   - implementation handoff exists
   - this definition-of-done artifact exists
   - `RF-007` row is updated to `Completed`
   - `US-025` has `passes: true`
   - `progress.txt` records a Summary of Work entry
   - `docs/history/forge_history.md` records the full story result
   - `docs/history/history_index.md` records one library-card row
   - `AGENTS.md` is not used for the long-form story entry
