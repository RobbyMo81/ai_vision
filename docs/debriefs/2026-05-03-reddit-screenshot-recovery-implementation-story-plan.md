# Reddit And Screenshot Recovery Implementation Story Plan

Date: 2026-05-03
Status: Planning document for Forge story promotion

## Purpose

Define the implementation stories that should be promoted from the Reddit duplicate-check stall investigation and screenshot timing audit.

Source investigation:

- `docs/debriefs/2026-05-03-reddit-duplicate-check-stall-blast-radius.md`

This is not yet a Forge handoff package. Each story below still needs the four mandatory Forge handoff artifacts before a builder agent should implement it.

## Implementation Sequence

1. `US-040 / RF-022` - Deterministic Reddit Duplicate Evidence Producer - promoted to Forge handoff on 2026-05-03
2. `US-041 / RF-023` - Screenshot Capture Scheduler And Hung-Step Guardrail - promoted to Forge handoff on 2026-05-03
3. `US-042 / RF-024` - Post-Task Screenshot TTL Cleanup And Recovery

The stories should be built in this order. `US-040` fixes the direct production workflow blocker. `US-041` reduces capture pressure during stalled or long-running steps. `US-042` finishes the retention timing change so successful runs keep debug frames briefly, then clean them without burdening wrap-up.

## Story 1: US-040 / RF-022 - Deterministic Reddit Duplicate Evidence Producer

### Problem

The current `check_duplicate_reddit_post` step delegates duplicate evidence generation to `browser-use`. In the failed production attempts, the agent reached `r/test/new`, found roughly 50 post title elements, then stalled while trying to extract and score titles. The submit gate worked, but the workflow could not proceed.

### Scope

Replace the LLM/browser-use duplicate-check producer with a deterministic TypeScript/Playwright path for direct Reddit workflows.

### Required Behavior

- Navigate to `/r/{subreddit}/new`.
- Collect a bounded set of recent post titles.
- Score candidate title against observed titles using word-level Jaccard.
- Preserve the existing evidence contract:
  - `EXTRACTED_TITLES: <json array>`
  - `OVERLAP_SCORES: <json array>`
  - `DUPLICATE_CHECK_RESULT: NO_DUPLICATE_FOUND | DUPLICATE_RISK`
  - `MATCHING_TITLE: <title>` only when duplicate risk exists
- Navigate back to `/r/{subreddit}/submit`.
- Keep the existing `submit_reddit_post` duplicate evidence gate unchanged.

### Thresholds

| Score range | Classification | Submit behavior |
| --- | --- | --- |
| `>= 0.70` | `DUPLICATE_RISK` | Block submit and include `MATCHING_TITLE`. |
| `>= 0.50` and `< 0.70` | Near-match metadata | Do not block under the current contract; include score for visibility. |
| `< 0.50` | `NO_DUPLICATE_FOUND` | Allow submit if evidence contract is valid. |

### Selectors

Primary selector:

```css
a[id^="post-title-"]
```

Fallback selectors:

```css
shreddit-post a[id^="post-title-"]
article a[id^="post-title-"]
[data-testid="post-title"]
h1, h2, h3
```

### Extraction Rules

- Use `textContent`.
- Trim each title.
- Drop empty strings.
- Drop standalone UI labels: `comment`, `comments`, `share`, `vote`, `promoted`, `advertisement`.
- Deduplicate case-insensitively while preserving first-seen display text.
- Limit to the first `50` usable titles.
- Do not infinite-scroll.
- Allow at most one bounded scroll-and-retry when zero titles are found.

### Complexity Bound

```text
n = collected titles, capped at 50
m = average normalized title token count
c = candidate title token count

normalization: O(n * m + c)
scoring:       O(n * (m + c))
memory:        O(n * m)
```

The implementation must only compare the candidate title against observed titles. It must not perform pairwise title comparisons.

### Fail-Closed Rule

If no usable titles are collected after selector fallback, the step must fail. It must not return `NO_DUPLICATE_FOUND`.

### Acceptance Criteria

- Direct `post_to_reddit` no longer uses `browser-use` for `check_duplicate_reddit_post`.
- The duplicate evidence output still passes the existing parser.
- `DUPLICATE_RISK` at `>= 0.70` blocks `submit_reddit_post`.
- Near matches between `0.50` and `0.70` are visible in scores but do not change the canonical result.
- DOM drift or zero collected titles fails closed.
- Focused tests cover duplicate, near-match, no-duplicate, zero-title, and selector fallback cases.

## Story 2: US-041 / RF-023 - Screenshot Capture Scheduler And Hung-Step Guardrail

### Problem

The HITL UI live push loop, rolling debug timer, MCP screenshot requests, workflow evidence screenshots, and browser-use action screenshots can overlap. During the Reddit stall, screenshot loops continued while the workflow made no progress, creating excessive telemetry and rolling debug frames.

### Scope

Add a shared screenshot capture scheduler around `SessionManager.captureScreenshot(...)` callers that use Playwright `page.screenshot()` in the Node runtime.

### Required Behavior

- Collapse duplicate UI live-frame requests when a capture is already in flight.
- Give explicit workflow evidence screenshots priority over UI live frames and rolling debug frames.
- Allow MCP screenshots through the same scheduler and existing policy gate.
- Preserve sensitive-phase blocking and redaction behavior from US-038.
- Add a hung-step guardrail for rolling debug capture:
  - Detect when the same workflow step remains active beyond a bounded duration.
  - Pause or sharply throttle rolling debug frames during the stall.
  - Resume normal rolling cadence on step advance.
- Emit byte-free telemetry for scheduler queue/collapse/throttle decisions.
- Ensure screenshot telemetry sets the top-level `step_id` where the current step is known.

### Suggested Defaults

- UI live-frame collapse window: while one UI live capture is in flight.
- Rolling debug cadence: keep current `5000ms` when healthy.
- Hung-step rolling throttle threshold: `30000ms` on the same step with no step transition.
- Throttled rolling cadence: no more than one debug frame per `60000ms`, or fully paused if implementation is simpler and telemetry records the pause.

### Acceptance Criteria

- Concurrent UI live-frame requests do not launch duplicate `page.screenshot()` calls.
- Workflow evidence screenshot requests are not starved by UI or rolling captures.
- Rolling debug capture is paused or throttled after the same step exceeds the hung threshold.
- Step advance resets the hung-step guardrail.
- Existing screenshot policy tests remain valid.
- Focused tests prove scheduler priority, UI collapse, rolling throttle, and top-level `step_id` telemetry.

## Story 3: US-042 / RF-024 - Post-Task Screenshot TTL Cleanup And Recovery

### Problem

Current cleanup does not fully implement the desired rolling/debug retention model. `cleanupWorkflowScreenshotsOnWrapUp(...)` only iterates `WorkflowResult.screenshots`, but rolling debug frames are written directly to `sessions/rolling/` and are not included in the workflow result screenshot list.

### Scope

Implement a success-only post-task cleanup scheduler for rolling/debug screenshots with startup recovery for lost timers.

### Required Behavior

| Trigger point | Condition | Action |
| --- | --- | --- |
| Workflow completion | `workflow_result == success` | Stop rolling timer and schedule a `120000ms` rolling/debug cleanup timer. |
| TTL expiry | Session still qualifies | Delete `sessions/rolling/*.jpg` and eligible debug frames. |
| Failure or abort | `workflow_result != success` or no durable success row exists | Fall back to `ttl_24h` debug retention. |
| Process restart during TTL | Timer was lost | Startup cleanup treats successful-run debug artifacts older than `120s` as expired. |

### Required Safeguards

- Do not delete evidence screenshots.
- Do not delete files indexed as `keep_until_manual_review`.
- Use SQLite workflow success state as the source of truth when recovering lost timers.
- Add retry-with-backoff around unlink operations.
- Keep failed deletion rows in `screenshot_cleanup_failures`.
- Emit byte-free telemetry:
  - `session.cleanup.scheduled`
  - `session.cleanup.completed`
  - `session.cleanup.failed`

### Acceptance Criteria

- Successful runs retain rolling/debug frames for roughly 120 seconds, then delete them.
- Failed and aborted runs preserve debug frames under `ttl_24h`.
- Restart during the 120s window does not create permanent orphaned rolling files.
- Rolling directory cleanup is explicitly covered; it does not rely only on `WorkflowResult.screenshots`.
- Evidence and manual-review screenshots are preserved.
- Focused tests cover success timer, failure fallback, startup recovery, retry failure recording, and evidence skip behavior.

## Out Of Scope

- Changing Reddit submit safety gates.
- Changing screenshot payload shape from US-036.
- Reopening US-037 persistence sanitization.
- Reopening US-038 sensitive screenshot policy.
- Reopening US-039 evidence audit schema unless a small additive field is required for recovery.
- Retiring `mode: agentic`; agentic paths remain guardrail-only unless still active when screenshot-bearing workflows are run.

## Promotion Checklist

Before implementation, each story must be promoted into a complete Forge handoff package under `docs/artifacts/`:

1. First-class Forge storyline.
2. Compact YAML story card.
3. AI agent implementation prompt.
4. Explicit definition of done.

`US-040 / RF-022` has been promoted to a complete Forge handoff package:

- `docs/artifacts/2026-05-03-us040-rf022-deterministic-reddit-duplicate-evidence-storyline.md`
- `docs/artifacts/2026-05-03-us040-rf022-deterministic-reddit-duplicate-evidence-forge-story.yaml`
- `docs/artifacts/2026-05-03-us040-rf022-deterministic-reddit-duplicate-evidence-implementation-handoff.md`
- `docs/artifacts/2026-05-03-us040-rf022-deterministic-reddit-duplicate-evidence-definition-of-done.md`

`US-041 / RF-023` has been promoted to a complete Forge handoff package:

- `docs/artifacts/2026-05-03-us041-rf023-screenshot-capture-scheduler-hung-step-guardrail-storyline.md`
- `docs/artifacts/2026-05-03-us041-rf023-screenshot-capture-scheduler-hung-step-guardrail-forge-story.yaml`
- `docs/artifacts/2026-05-03-us041-rf023-screenshot-capture-scheduler-hung-step-guardrail-implementation-handoff.md`
- `docs/artifacts/2026-05-03-us041-rf023-screenshot-capture-scheduler-hung-step-guardrail-definition-of-done.md`

`US-042 / RF-024` has been promoted to a complete Forge handoff package:

- `docs/artifacts/2026-05-03-us042-rf024-post-task-screenshot-ttl-cleanup-recovery-storyline.md`
- `docs/artifacts/2026-05-03-us042-rf024-post-task-screenshot-ttl-cleanup-recovery-forge-story.yaml`
- `docs/artifacts/2026-05-03-us042-rf024-post-task-screenshot-ttl-cleanup-recovery-implementation-handoff.md`
- `docs/artifacts/2026-05-03-us042-rf024-post-task-screenshot-ttl-cleanup-recovery-definition-of-done.md`
