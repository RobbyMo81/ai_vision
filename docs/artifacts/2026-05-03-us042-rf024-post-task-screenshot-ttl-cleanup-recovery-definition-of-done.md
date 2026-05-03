# US-042 / RF-024 Definition Of Done

## Done Means

`US-042 / RF-024` is done when successful workflow runs keep rolling/debug screenshots for a bounded 120 second post-task window and then clean them up automatically, while failed/aborted runs keep debug frames under the existing `ttl_24h` policy.

## Required Outcomes

1. Successful workflow completion schedules a `120000ms` post-task cleanup for rolling/debug screenshots.
2. Rolling capture is stopped before success cleanup is scheduled.
3. Successful-run rolling/debug files remain available before TTL expiry.
4. Successful-run rolling/debug files are deleted after TTL expiry.
5. Failed and aborted runs do not use the 120 second success cleanup path.
6. Failed and aborted debug files remain governed by `ttl_24h`.
7. Startup recovery deletes successful-run rolling/debug files whose cleanup timer was lost and whose 120 second TTL has expired.
8. Startup recovery remains bounded and does not block browser/session availability.
9. Rolling directory cleanup is explicit and does not rely only on `WorkflowResult.screenshots`.
10. Evidence screenshots and `keep_until_manual_review` screenshots are preserved.
11. Failed unlink operations retry with backoff before a cleanup failure row is recorded.
12. `screenshot_cleanup_failures` records retryable failures that still cannot be deleted.
13. Cleanup telemetry is byte-free and reports scheduled, completed, and failed outcomes.
14. `US-036`, `US-037`, `US-038`, `US-039`, `US-041`, and `US-043` contracts remain compatible.

## Required Tests

Focused tests must prove:

1. Success schedules the post-task cleanup timer.
2. Pre-expiry successful-run files are retained.
3. Post-expiry successful-run files are deleted.
4. Failed run files are not deleted by the 120 second success cleanup.
5. Startup recovery handles lost success timers.
6. Startup recovery preserves failed/unknown files under `ttl_24h`.
7. Evidence/manual-review files are skipped.
8. Delete retry failure writes `screenshot_cleanup_failures`.
9. Telemetry emits aggregate byte-free cleanup events.

## Required Validation

The implementing agent must run and record:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand src/session/manager.test.ts src/workflow/wrap-up.test.ts src/workflow/engine.test.ts
```

Run full `pnpm test` if shared session/workflow retention contracts are touched broadly.

## Governance Closeout

The implementing agent must update:

1. `prd.json`
2. `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
3. `docs/artifacts/2026-05-03-us042-rf024-post-task-screenshot-ttl-cleanup-recovery-forge-story.yaml`
4. `docs/architecture/as-built_execution_atlas.md` if runtime flow changes materially
5. `progress.txt`
6. `docs/history/forge_history.md`
7. `docs/history/history_index.md`
8. Forge memory story state

The final response must include Summary of Work, files touched, acceptance criteria, and final validation result.

