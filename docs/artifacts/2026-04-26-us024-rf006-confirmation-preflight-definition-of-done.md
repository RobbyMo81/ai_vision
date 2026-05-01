# Direct Workflow Gate Layer — Phase 2: Final-Step Confirmation Pre-Flight Binding Enforcement — Definition Of Done

Story: `US-024`
Tracker Row: `RF-006`

The story is done only when all of the following are true:

1. Three pre-flight binding gates exist in the `POST /api/confirm-final-step` handler in `src/ui/server.ts`, evaluated in order:

   - **Gate 1 — Run-phase gate**: rejects HTTP 409 when `workflowEngine.currentState.phase !== 'hitl_qa'`
   - **Gate 2 — Session binding gate**: rejects HTTP 400 when `requestSessionId` is present and
     does not match `workflowEngine.currentState.id`
   - **Gate 3 — WebSocket presence gate**: rejects HTTP 403 when `resolvedClientId` is non-empty
     and `socketsForPage(resolvedClientId).size === 0`

2. Every rejected pre-flight gate emits a `ui.hitl.confirm_final_step.rejected` telemetry event
   containing:
   - the gate name that rejected the request
   - the rejection reason string
   - `requestSessionId`, `activeSessionId`
   - `resolvedClientId`, `matchingWsClientCount`
   - full caller attribution metadata (remote address, user-agent, origin, referer, host)
   - current `wsConnectionCount`

   The rejection event is emitted through one handler-scoped named const `emitConfirmationRejection`
   placed immediately after the existing `/api/confirm-final-step` attribution values are computed.
   The implementation must not use one-off inline emitters inside each gate branch and must not
   lift the helper outside the handler.

3. The active-tab happy path is unaffected:
   - a request where `phase === 'hitl_qa'`, `requestSessionId` matches the active session, and
     `matchingWsClientCount > 0` still reaches `hitlCoordinator.confirmCompletion`
     without any new rejection

4. `/api/return-control` has caller attribution trace parity with `/api/confirm-final-step`:
   - emits `ui.hitl.return_control.received` with caller metadata, `resolvedClientId`,
     `matchingWsClientIds`, and `matchingWsClientCount`
   - no enforcement added to this endpoint in this story

5. Non-UI callers with empty `resolvedClientId` are not blocked in this story (deferred to a
   later caller-allowlist design story).

6. Regression tests cover:
   - Gate 1 rejection (run-phase gate — phase not hitl_qa → HTTP 409)
   - Gate 2 rejection (session binding gate — sessionId mismatch → HTTP 400)
   - Gate 3 rejection (websocket presence gate — stale client → HTTP 403)
   - Active-tab happy path succeeds end-to-end (all gates pass → `hitlCoordinator` reached)
   - `ui.hitl.confirm_final_step.rejected` telemetry fires for each rejection path
   - `/api/return-control` emits `ui.hitl.return_control.received` with attribution fields

7. Quality gates:
   - `pnpm run typecheck` exits 0
   - `pnpm test` exits 0 with all suites passing

8. The Forge evidence trail is complete:
   - storyline artifact exists at `docs/artifacts/2026-04-26-us024-rf006-confirmation-preflight-storyline.md`
   - YAML story card exists at `docs/artifacts/2026-04-26-us024-rf006-confirmation-preflight-forge-story.yaml`
   - implementation handoff exists at `docs/artifacts/2026-04-26-us024-rf006-confirmation-preflight-implementation-handoff.md`
   - this definition-of-done artifact exists
   - RF-006 row in `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md` updated to Completed
   - US-024 `passes: true` in `prd.json`
   - `progress.txt` records a Summary of Work entry
   - `/home/spoq/ai-vision/docs/history/forge_history.md` records the full story history entry
   - `/home/spoq/ai-vision/docs/history/history_index.md` records the quick-reference library card entry
