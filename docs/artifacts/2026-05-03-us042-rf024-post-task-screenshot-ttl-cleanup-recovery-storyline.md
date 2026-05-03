# US-042 / RF-024 Storyline: Post-Task Screenshot TTL Cleanup And Recovery

Use the Forge system and Forge build loop for this story.

## Problem

Rolling/debug screenshot cleanup still has a timing gap.

`SessionManager.startScreenshotTimer(...)` writes rolling frames directly into `sessions/rolling/*.jpg`. Those frames are not part of `WorkflowResult.screenshots`, so `cleanupWorkflowScreenshotsOnWrapUp(...)` cannot fully clean them by iterating the workflow result screenshot list.

The current runtime has useful building blocks from prior stories:

- `US-037` strips screenshot bytes from durable JSON persistence.
- `US-038` gates screenshot capture before pixels leave the browser.
- `US-039` added screenshot retention helpers, evidence audit, cleanup failure records, and bounded startup scavenging.
- `US-041` reduced capture pressure with a screenshot scheduler and hung-step rolling guardrail.

What remains is the post-task retention timing: successful workflow runs should keep rolling/debug frames briefly for immediate verification, then purge them without burdening the critical wrap-up path. Failed or aborted runs should retain debug frames under the existing `ttl_24h` policy.

## Goal

Implement a success-only post-task cleanup scheduler for rolling/debug screenshots with startup recovery for lost timers.

The target behavior is:

1. On successful workflow completion, stop rolling capture and schedule a 120 second cleanup timer.
2. During the 120 second window, rolling/debug files remain available for immediate post-run verification.
3. At TTL expiry, delete eligible rolling/debug files for that successful run.
4. On failed or aborted workflows, do not apply the 120 second success cleanup; leave debug frames under `ttl_24h`.
5. On process restart, recover lost success timers by deleting successful-run rolling/debug artifacts older than 120 seconds.

## Required Behavior

| Trigger point | Condition | Action |
| --- | --- | --- |
| Workflow completion | `workflow_result == success` | Stop rolling timer and schedule a `120000ms` rolling/debug cleanup timer. |
| TTL expiry | Session still qualifies as successful and files are still eligible | Delete `sessions/rolling/*.jpg` and eligible debug frames; record cleanup telemetry and failures. |
| Failure or abort | `workflow_result != success` or no durable success row exists | Do not run 120s cleanup; preserve debug frames under fallback `ttl_24h`. |
| Process restart during TTL | Prior timer was lost | Startup cleanup treats successful-run rolling/debug artifacts older than `120s` as expired and eligible for immediate cleanup. |

## In Scope

1. Add a post-task cleanup scheduler for successful workflow runs.
2. Stop rolling capture before scheduling success cleanup.
3. Explicitly clean the rolling directory; do not rely only on `WorkflowResult.screenshots`.
4. Use SQLite workflow success state as the durable source of truth for startup recovery.
5. Preserve evidence screenshots and anything indexed as `keep_until_manual_review`.
6. Preserve failed/aborted run debug frames under `ttl_24h`.
7. Add retry-with-backoff around unlink operations.
8. Record failed deletions in `screenshot_cleanup_failures`.
9. Emit byte-free telemetry:
   - `session.cleanup.scheduled`
   - `session.cleanup.completed`
   - `session.cleanup.failed`
10. Keep startup cleanup bounded and off the critical browser/session startup path.

## Out Of Scope

1. Changing Reddit submit safety gates.
2. Changing the LLM post-action evidence contract from `US-043`.
3. Changing screenshot payload shape from `US-036`.
4. Reopening `US-037` persistence sanitization.
5. Reopening `US-038` sensitive screenshot policy.
6. Reopening `US-039` evidence audit schema unless a tiny additive recovery field is required.
7. Retiring `mode: agentic`.
8. Implementing encryption-at-rest or historical screenshot migration.

## Required Code Surfaces

Start by inspecting:

1. `src/session/screenshot-retention.ts`
2. `src/session/manager.ts`
3. `src/workflow/engine.ts`
4. `src/workflow/wrap-up.ts`
5. `src/db/repository.ts`
6. `src/session/manager.test.ts`
7. `src/workflow/wrap-up.test.ts`
8. `src/workflow/engine.test.ts`

Expected implementation ownership:

- `src/session/screenshot-retention.ts` owns retention timing, eligibility, retry-with-backoff deletion, rolling-directory cleanup, and startup recovery helpers.
- `src/workflow/engine.ts` or the wrap-up boundary coordinates success completion timing after `finalResult` is known and rolling capture has stopped.
- `src/db/repository.ts` provides any narrowly needed query to identify successful workflow runs for startup recovery.
- Tests should stay focused on retention behavior, not Reddit behavior.

## Acceptance Criteria

1. Successful workflow runs schedule a `120000ms` post-task cleanup for rolling/debug screenshots.
2. Successful-run rolling/debug files remain available before the TTL expires.
3. Successful-run rolling/debug files are deleted after the TTL expires.
4. Failed and aborted runs do not use the 120 second success cleanup path and remain under `ttl_24h`.
5. Startup recovery deletes successful-run rolling/debug artifacts whose success cleanup timer was lost and whose TTL has expired.
6. Rolling directory cleanup is explicitly covered and does not rely only on `WorkflowResult.screenshots`.
7. Evidence screenshots and `keep_until_manual_review` files are preserved.
8. Failed unlink operations are retried with backoff and recorded in `screenshot_cleanup_failures` when still failing.
9. Cleanup telemetry is byte-free and reports scheduled, completed, and failed cleanup outcomes.
10. `US-036` through `US-043` contracts remain compatible.

## Exit Criteria

Exit only when successful-run rolling/debug files have a bounded 120 second post-task lifetime, failed/aborted debug frames keep the existing `ttl_24h` behavior, restart recovery prevents permanent successful-run rolling orphans, evidence is preserved, and focused validation passes.

