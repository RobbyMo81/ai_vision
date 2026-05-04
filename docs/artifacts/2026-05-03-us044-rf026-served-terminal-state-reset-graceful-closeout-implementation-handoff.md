# US-044 / RF-026 Implementation Handoff

## Agent Prompt

You are the build agent for `US-044 / RF-026: Served Terminal State Reset And Graceful Closeout Handler`.

Use the Forge system and the Forge build loop explicitly. Before editing code, read:

1. `FORGE.md`
2. `AGENTS.md`
3. `prd.json`
4. `progress.txt`
5. `docs/artifacts/2026-05-03-us044-rf026-served-terminal-state-reset-graceful-closeout-storyline.md`
6. `docs/artifacts/2026-05-03-us044-rf026-served-terminal-state-reset-graceful-closeout-forge-story.yaml`
7. `docs/artifacts/2026-05-03-us044-rf026-served-terminal-state-reset-graceful-closeout-definition-of-done.md`
8. `src/cli/index.ts`
9. `src/ui/server.ts`
10. `src/ui/server.test.ts`
11. `src/workflow/engine.ts`
12. `src/workflow/engine.test.ts`
13. `src/session/hitl.ts`
14. `src/session/manager.ts`

## Build Intent

The served ai-vision process needs a complete terminal-state reset and graceful closeout handler. A failed or completed workflow should not leave the UI pinned to stale workflow context after the browser has closed. Operators must be able to acknowledge the terminal state and return the served app to idle without restarting the process.

## Required Implementation Shape

1. Add a terminal reset path for the served UI.
   - Suggested endpoint: `POST /api/workflow/reset-terminal`.
   - Accept `sessionId`, `requestId`, `clientId`, optional `dod`, and optional `comments`.
   - Require the active state to be terminal (`complete` or `error`).
   - Reject active non-terminal workflow states.
   - Reject mismatched session ids.

2. Preserve active HITL protections.
   - Do not use terminal reset to bypass `awaiting_human`, `pii_wait`, approval waits, final confirmation waits, or active `hitl_qa` waits.
   - Keep `/api/return-control` and `/api/confirm-final-step` as the only active-wait resume paths.

3. Add a workflow-engine state reset helper.
   - The helper should clear public active workflow state after terminal acknowledgement.
   - It should broadcast or enable UI broadcast of `{ phase: "idle" }`.
   - It should leave durable history, wrap-up artifacts, telemetry, and SQLite records intact.

4. Wire the UI close action.
   - When the state is terminal and no active wait is pending, the UI close button should call the terminal reset endpoint.
   - Existing `Dismiss & Close` during active `hitl_qa:capture_notes` should keep the current return-control behavior until the wait resolves.
   - After reset, screenshot polling should stop showing stale context and the status panel should return to idle.

5. Add served-process shutdown handling.
   - In `serve` mode, keep references to UI and webhook HTTP servers.
   - On `SIGINT` and `SIGTERM`, best-effort close UI server, webhook server, registry engines, and session manager.
   - Emit byte-free telemetry for shutdown started/completed/failed.
   - Avoid marking in-flight workflows as successful.

6. Add byte-free telemetry.
   - `ui.workflow_terminal_reset.requested`
   - `ui.workflow_terminal_reset.completed`
   - `ui.workflow_terminal_reset.rejected`
   - `serve.shutdown.started`
   - `serve.shutdown.completed`
   - `serve.shutdown.failed`

Names may be refined, but telemetry must preserve these decisions.

## Required Tests

Add focused coverage for:

1. Terminal `error` state reset returns idle.
2. Terminal `complete` state reset returns idle.
3. Terminal reset works when `sessionManager.isStarted` is false.
4. Reset with mismatched session id is rejected.
5. Reset during active non-terminal workflow is rejected.
6. Reset does not call `hitlCoordinator.returnControl()` when no active wait exists.
7. Active HITL wait still uses the existing return-control or confirmation path.
8. Connected clients receive idle state after reset.
9. Screenshot polling does not keep stale workflow context after reset.
10. Served shutdown handler closes registered servers/session resources best-effort.

## Validation

Run and record:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand src/ui/server.test.ts src/workflow/engine.test.ts
```

Run broader focused tests if implementation touches `src/session/manager.ts`, `src/webhooks/server.ts`, or MCP lifecycle code:

```bash
pnpm test -- --runInBand src/session/manager.test.ts src/webhooks/server.test.ts src/mcp/server.test.ts
```

## Closeout Requirements

At closeout, update:

1. `prd.json`
2. `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
3. `docs/artifacts/2026-05-03-us044-rf026-served-terminal-state-reset-graceful-closeout-forge-story.yaml`
4. `docs/architecture/as-built_execution_atlas.md` if lifecycle ownership or served workflow shape changes materially
5. `progress.txt`
6. `docs/history/forge_history.md`
7. `docs/history/history_index.md`
8. Forge memory story state

The final response must include Summary of Work, files touched, acceptance criteria, and final validation result.

