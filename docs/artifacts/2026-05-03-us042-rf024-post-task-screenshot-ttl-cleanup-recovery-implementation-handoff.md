# US-042 / RF-024 Implementation Handoff

## Agent Prompt

You are the build agent for `US-042 / RF-024: Post-Task Screenshot TTL Cleanup And Recovery`.

Use the Forge system and the Forge build loop explicitly. Before editing code, read:

1. `FORGE.md`
2. `AGENTS.md`
3. `prd.json`
4. `progress.txt`
5. `docs/debriefs/2026-05-03-reddit-duplicate-check-stall-blast-radius.md`
6. `docs/debriefs/2026-05-03-reddit-screenshot-recovery-implementation-story-plan.md`
7. `docs/artifacts/2026-05-03-us042-rf024-post-task-screenshot-ttl-cleanup-recovery-storyline.md`
8. `docs/artifacts/2026-05-03-us042-rf024-post-task-screenshot-ttl-cleanup-recovery-forge-story.yaml`
9. `docs/artifacts/2026-05-03-us042-rf024-post-task-screenshot-ttl-cleanup-recovery-definition-of-done.md`
10. `src/session/screenshot-retention.ts`
11. `src/session/manager.ts`
12. `src/workflow/engine.ts`
13. `src/workflow/wrap-up.ts`
14. `src/db/repository.ts`

## Build Intent

Implement a success-only post-task cleanup scheduler so rolling/debug screenshots from successful workflow runs are retained for a short verification window, then deleted automatically.

The implementation must explicitly handle `sessions/rolling/*.jpg`; do not rely only on `WorkflowResult.screenshots`.

## Required Runtime Shape

1. Stop rolling capture before scheduling success cleanup.
2. On successful workflow completion, schedule a `120000ms` cleanup timer for rolling/debug screenshots.
3. Before TTL expiry, successful-run rolling/debug files must remain available.
4. At TTL expiry, delete eligible rolling/debug files and record aggregate byte-free telemetry.
5. On failed or aborted workflow completion, do not run the 120 second success cleanup path.
6. Keep failed/aborted debug frames under `ttl_24h`.
7. Preserve evidence screenshots and files indexed as `keep_until_manual_review`.
8. On startup, recover lost timers by deleting successful-run rolling/debug artifacts older than 120 seconds.
9. Use durable workflow success state from SQLite as source of truth for restart recovery.
10. Add retry-with-backoff around unlink operations before recording `screenshot_cleanup_failures`.

## Suggested Code Shape

Prefer adding small, testable helpers in `src/session/screenshot-retention.ts`, for example:

- `schedulePostTaskScreenshotCleanup(...)`
- `cleanupSuccessfulRunRollingScreenshots(...)`
- `runPostTaskScreenshotCleanupRecovery(...)`
- `deleteScreenshotFileWithRetry(...)`

Names may differ, but keep ownership in the retention/session layer. Avoid putting raw filesystem cleanup logic directly in `src/workflow/engine.ts`.

`src/workflow/engine.ts` should only coordinate the lifecycle once `finalResult.success` is known and rolling capture has stopped.

`src/db/repository.ts` may need a narrow query for successful workflow run recovery. Keep it repository-owned; do not add raw SQL into business logic.

## Required Tests

Add focused tests proving:

1. Successful workflow schedules 120 second cleanup after rolling capture stops.
2. Cleanup does not delete rolling/debug files before TTL expiry.
3. Cleanup deletes eligible rolling/debug files after TTL expiry.
4. Failed workflow does not schedule the success cleanup.
5. Startup recovery deletes successful-run artifacts whose timer was lost and TTL has expired.
6. Startup recovery does not delete failed/aborted artifacts before `ttl_24h`.
7. Evidence and `keep_until_manual_review` screenshots are skipped.
8. Failed unlink operations retry and then record `screenshot_cleanup_failures`.
9. Telemetry uses aggregate counts and file metadata only; no image bytes or base64.

## Required Validation

Run and record:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand src/session/manager.test.ts src/workflow/wrap-up.test.ts src/workflow/engine.test.ts
```

Run full `pnpm test` if shared retention/session/workflow contracts are touched broadly.

## Closeout Requirements

At closeout, update:

1. `prd.json`
2. `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
3. `docs/artifacts/2026-05-03-us042-rf024-post-task-screenshot-ttl-cleanup-recovery-forge-story.yaml`
4. `docs/architecture/as-built_execution_atlas.md` if runtime flow changes materially
5. `progress.txt`
6. `docs/history/forge_history.md`
7. `docs/history/history_index.md`
8. Forge memory story state

The final response must include Summary of Work, files touched, acceptance criteria, and final validation result.

