# US-044 / RF-026 Storyline: Served Terminal State Reset And Graceful Closeout Handler

Use the Forge system and Forge build loop for this story.

## Problem

The served ai-vision application can preserve a stale terminal workflow state after a failed run has already closed the browser.

Observed production shape on 2026-05-03:

1. `ai-vision serve --headed` stayed alive on `http://localhost:3000`.
2. The active workflow state was terminal `phase: error`.
3. The UI still showed the failed workflow step and HITL QA controls.
4. `/api/screenshot` returned `Browser not started` because the browser had already been closed.
5. The `Dismiss & Close` path was not a complete reset path once no active HITL wait promise remained.
6. Recovery required restarting the served process.

The workflow engine has closeout behavior for normal workflow execution, but the long-running served process does not yet have a complete terminal-state closeout and reset handler.

## Goal

Add a graceful terminal-state and reset boundary for served workflows so a completed or failed run can be acknowledged, closed, and returned to a clean idle state without restarting `ai-vision serve`.

The operator experience should be:

1. terminal workflow state is visible long enough for review;
2. terminal closeout can be explicitly acknowledged even after the browser is closed;
3. stale workflow context is cleared from `/api/status` and websocket projections;
4. screenshot polling stops or returns an idle-safe response;
5. the next workflow can start from a clean served-process state.

## Scope

In scope:

1. Add a served-process terminal reset API for completed and failed workflow states.
2. Make terminal `Dismiss & Close` call the reset path when no active HITL wait is pending.
3. Keep active HITL waits protected by the existing return-control gates.
4. Clear or archive `workflowEngine.currentState` after terminal acknowledgement.
5. Broadcast an idle state to connected UI clients after reset.
6. Make `/api/status` return idle after reset.
7. Make screenshot polling terminal/idle aware so `Browser not started` does not look like an active workflow failure after reset.
8. Emit byte-free telemetry for terminal reset requested, completed, rejected, and stale-terminal recovery.
9. Preserve wrap-up persistence, social outcome classification, US-042 screenshot TTL cleanup, and US-043 post-action evidence behavior.
10. Add focused UI/workflow tests for terminal reset behavior.

Out of scope:

1. Changing Reddit submit postconditions.
2. Changing LLM post-action evidence parsing.
3. Changing screenshot retention TTL rules.
4. Removing HITL review for failed workflows.
5. Adding a broad process supervisor or service manager.
6. Changing MCP protocol behavior except where served-process reset state must remain coherent.

## Required Behavior

### Terminal State Acknowledgement

When `workflowEngine.currentState.phase` is `complete` or `error`, the UI must offer a closeout action that works even if no HITL wait promise exists.

The reset action should:

1. verify the request is bound to the active terminal session when a session id is supplied;
2. reject reset attempts against active non-terminal runs;
3. persist any supplied DoD/comments on the terminal state before clearing it when possible;
4. clear public active workflow state;
5. broadcast `{ phase: "idle" }`;
6. leave durable workflow history intact.

### Active HITL Protection

If the workflow is still in `awaiting_human`, `pii_wait`, or `hitl_qa` with an active wait, existing HITL return-control and confirm-final-step gates remain authoritative.

The reset path must not bypass active approval, secure input, final confirmation, or draft approval waits.

### Served Shutdown Handling

The served process should have one explicit best-effort shutdown handler for `SIGINT` and `SIGTERM` that closes:

1. UI HTTP server;
2. webhook server;
3. MCP/engine resources where exposed;
4. active browser/session manager;
5. any screenshot timers or cleanup timers that have explicit close hooks.

The handler should avoid corrupting in-flight workflow wrap-up. If a workflow is active, it should emit telemetry and perform best-effort cleanup without pretending the run completed.

### Stale Terminal Recovery

If the server is already holding a terminal state with no browser and no active HITL wait, reset should be allowed and should not require restarting the process.

This is the exact failure shape observed after the 2026-05-03 Reddit run.

## Acceptance Criteria

1. Served terminal `complete` and `error` states can be acknowledged and reset to idle without restarting the process.
2. Terminal reset works when the browser has already been closed.
3. Terminal reset does not call `hitlCoordinator.returnControl()` when no active wait exists.
4. Active non-terminal HITL waits still require the existing return-control or confirmation APIs.
5. `/api/status` returns `{ "phase": "idle" }` after terminal reset.
6. Connected UI clients receive an idle websocket state after terminal reset.
7. Screenshot polling after terminal reset does not keep rendering stale workflow context.
8. Reset attempts with mismatched session ids are rejected.
9. Reset attempts during active non-terminal workflows are rejected.
10. Served `SIGINT` and `SIGTERM` paths perform best-effort closeout of servers, engines, and browser/session resources.
11. Telemetry records byte-free reset requested/completed/rejected/shutdown events.
12. Existing workflow closeout, wrap-up persistence, US-042 screenshot cleanup, and US-043 post-action evidence tests remain compatible.

## Exit Criteria

Exit only when the served ai-vision UI can recover from a terminal failed or completed workflow without process restart, and the next workflow can start from clean idle state while durable workflow history remains intact.

