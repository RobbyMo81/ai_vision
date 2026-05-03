# US-038 / RF-020 Definition Of Done

## Done Means

`US-038 / RF-020` is done when screenshot capture is governed before pixels leave the browser. Sensitive screenshots are redacted or blocked, temporary screenshots expire on step advance, UI/MCP access is bound to active context, and blocked captures return structured next-action metadata instead of opaque failures.

## Required Outcomes

1. Screenshot requests are classified as `live_frame`, `debug_frame`, `step_scoped`, `evidence`, or `sensitive_blocked`.
2. A shared policy decision uses phase, step id, source, session/client context, and workflow sensitivity metadata.
3. `pii_wait` screenshot attempts return no unredacted pixels.
4. Sensitive-target screenshot attempts redact/mask known sensitive regions or fail closed.
5. Temporary agent-context screenshots are tagged step-scoped and deleted on workflow step advance.
6. `GET /api/screenshot` uses active session/client binding consistent with the `US-024` pattern.
7. MCP screenshot capture is gated by the same policy contract.
8. Rolling/live screenshots are paused, denied, or step-scoped during sensitive phases.
9. Blocked responses include reason and next action while returning no screenshot bytes.
10. Telemetry records allow, redact, block, and delete decisions without image bytes.
11. US-036 payload compatibility and US-037 durable persistence sanitization remain intact.

## Required Tests

Focused tests must prove:

1. `pii_wait` capture denies pixels and returns structured next action.
2. sensitive-target capture redacts/masks or fails closed.
3. step-scoped screenshot bytes/temp files are deleted on step advance.
4. stale/mismatched/unbound `GET /api/screenshot` callers are rejected.
5. MCP screenshot capture follows the same policy gate.
6. telemetry includes policy decisions without screenshot bytes.
7. existing payload and persistence tests still pass.

## Required Validation

The implementing agent must run and record:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand <focused test files>
```

Run full `pnpm test` if shared screenshot/session contracts are touched broadly.

## Governance Closeout

The implementing agent must update:

1. `prd.json`
2. `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
3. `progress.txt`
4. `docs/history/forge_history.md`
5. `docs/history/history_index.md`
6. Forge memory story state

The final response must include Summary of Work, files touched, acceptance criteria, and final validation result.
