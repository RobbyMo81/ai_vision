# US-041 / RF-023 Definition Of Done

## Done Means

`US-041 / RF-023` is done when screenshot capture requests are coordinated through a scheduler, duplicate live/debug captures no longer create avoidable contention, rolling debug capture is paused or throttled during hung steps, and existing screenshot policy behavior remains intact.

## Required Outcomes

1. UI live-frame captures collapse while one UI capture is already in flight.
2. Workflow evidence screenshot requests are prioritized over UI live frames and rolling debug frames.
3. MCP screenshot requests use the scheduler and existing screenshot policy gate.
4. Rolling debug capture uses the scheduler.
5. Rolling debug capture pauses or sharply throttles when the same workflow step exceeds the hung-step threshold.
6. Step advance resets the hung-step guardrail.
7. Sensitive screenshot blocking/redaction from US-038 remains compatible.
8. Screenshot telemetry sets top-level `stepId` where current workflow step is known.
9. Scheduler telemetry records queued, collapsed, executed, throttled, and skipped decisions without screenshot bytes.
10. Existing screenshot payload and persistence contracts remain compatible.
11. No post-task TTL cleanup is implemented in this story.

## Required Tests

Focused tests must prove:

1. UI live-frame collapse avoids duplicate screenshot encoding.
2. Collapsed UI requests preserve stable UI behavior.
3. Evidence screenshots are not starved by low-priority requests.
4. MCP capture goes through scheduler and policy.
5. Rolling debug capture throttles or pauses after a hung-step threshold.
6. Step advance resets rolling throttle state.
7. Sensitive-phase capture behavior remains blocked/redacted as before.
8. Top-level `stepId` is emitted on screenshot telemetry when known.
9. Scheduler telemetry is byte-free.

## Required Validation

The implementing agent must run and record:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand src/session/manager.test.ts src/ui/server.test.ts src/mcp/server.test.ts src/workflow/engine.test.ts
```

Run full `pnpm test` if shared session/workflow contracts are touched broadly.

## Governance Closeout

The implementing agent must update:

1. `prd.json`
2. `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
3. `docs/artifacts/2026-05-03-us041-rf023-screenshot-capture-scheduler-hung-step-guardrail-forge-story.yaml`
4. `docs/architecture/as-built_execution_atlas.md` if runtime flow changes materially
5. `progress.txt`
6. `docs/history/forge_history.md`
7. `docs/history/history_index.md`
8. Forge memory story state

The final response must include Summary of Work, files touched, acceptance criteria, and final validation result.
