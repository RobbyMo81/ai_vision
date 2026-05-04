# US-044 / RF-026 Definition Of Done

`US-044 / RF-026` is done when the served ai-vision app can close out a terminal workflow state and return to idle without restarting the process.

## Functional Requirements

1. Terminal `complete` states can be acknowledged and reset to idle.
2. Terminal `error` states can be acknowledged and reset to idle.
3. Reset works when the browser/session manager has already closed the browser.
4. Reset clears active public workflow state while preserving durable history.
5. `/api/status` returns idle after reset.
6. Connected websocket clients receive an idle state after reset.
7. Screenshot polling no longer displays stale workflow context after reset.
8. Reset is rejected for mismatched session ids.
9. Reset is rejected while a workflow is active and non-terminal.
10. Active HITL waits still require the existing return-control or final-confirmation APIs.
11. Terminal reset does not call `hitlCoordinator.returnControl()` when no wait is active.
12. Served `SIGINT` and `SIGTERM` perform best-effort cleanup of HTTP servers, engines, and browser/session resources.
13. Shutdown handling does not mark interrupted workflows as successful.
14. Telemetry for reset and shutdown is byte-free.

## Compatibility Requirements

1. Existing workflow wrap-up persistence remains intact.
2. US-042 post-task screenshot TTL cleanup remains intact.
3. US-043 LLM post-action evidence handling remains intact.
4. Existing HITL approval, draft approval, secure input, and final confirmation gates remain intact.
5. Existing UI session/client binding gates remain intact.

## Validation Requirements

The build agent must run and record:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand src/ui/server.test.ts src/workflow/engine.test.ts
```

If shared session, webhook, or MCP lifecycle code changes, also run the relevant focused suites.

## Governance Requirements

1. `prd.json` marks `US-044` complete only after implementation and validation.
2. `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md` marks `RF-026` complete only after implementation and validation.
3. The Forge story YAML status moves from `proposed` to `completed`.
4. `progress.txt` includes Summary of Work, files touched, acceptance criteria, and final validation result.
5. `docs/history/forge_history.md` and `docs/history/history_index.md` are updated after implementation completion.
6. Forge memory is updated with the story outcome and any durable discoveries.

