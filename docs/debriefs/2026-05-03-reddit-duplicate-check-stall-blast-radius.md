# Reddit Duplicate Check Stall Blast Radius

Date: 2026-05-03
Status: Investigation only

## Incident Summary

Two headed `post_to_reddit` production-test attempts were started against `r/test` after the runtime screenshot purge. Both reached `check_duplicate_reddit_post`, then stalled inside the `browser-use` duplicate-check task before the workflow could draft, submit, confirm, extract, or capture the final evidence screenshot.

The active app server remained healthy on ports `3000` and `3001`. The failed workflow UI on port `3002` was stopped manually. No workflow lock remained afterward, and runtime screenshot images under `sessions/` were purged back to zero.

## Epicenter

The epicenter is the `check_duplicate_reddit_post` agent task in `workflows/post_to_reddit.yaml`.

That step delegates the duplicate evidence producer to `browser-use` and asks it to:

- Navigate to `reddit.com/r/{{subreddit}}/new`.
- Collect every visible post title into JSON.
- Compute word-level Jaccard scores.
- Navigate back to submit.
- Return a strict four-line evidence contract.

The failure point is not the safety classifier. Telemetry showed the step was allowed as an evidence-producing read-only task. The stall occurred after `browser-use` found many Reddit post title elements and attempted a DOM `evaluate` extraction/scoring path.

## Evidence

- Affected sessions:
  - `1c89cd5a-3285-4e78-8719-c5a28a16a912`
  - `963dccad-bfd7-4d3f-857c-4bfcaf1ce8d5`
- Both sessions reached `check_duplicate_reddit_post`.
- Browser-use conversation artifacts show the latest action trying to extract `a[id^="post-title-"]` elements through `evaluate`.
- One run logged an LLM timeout after the Reddit title-gathering path.
- Telemetry contains `workflow.agent_task_side_effect.allowed` for `check_duplicate_reddit_post`.
- Telemetry does not contain a successful `workflow.step.finished` for `check_duplicate_reddit_post` in either affected session.
- SQLite `workflow_runs` has no persisted row for either manually interrupted session.
- The previous successful production verification session `0fc87308-785c-4fb4-a9fc-1ba782430c46` remains the last known complete `post_to_reddit` run.

## Excessive Screenshot Count Finding

The excessive screenshot numbers came from normal capture loops continuing while the workflow was stuck, not from an agent screenshot-perception loop.

Telemetry for the two interrupted sessions showed:

| Session | UI live frames | Rolling debug frames | Total `session.screenshot.allowed` |
| --- | ---: | ---: | ---: |
| `1c89cd5a-3285-4e78-8719-c5a28a16a912` | 136 | 39 | 175 |
| `963dccad-bfd7-4d3f-857c-4bfcaf1ce8d5` | 143 | 41 | 184 |

The UI frames were `accessPath=ui`, `class=live_frame`, `retention=ephemeral`. These inflated telemetry counts but should not persist as image files.

The rolling frames were `accessPath=rolling`, `class=debug_frame`, `retention=delete_on_success`. These match the roughly 80 runtime screenshot files that were later purged from `sessions/`.

The `browser-use` task did appear to see the page well enough to navigate and inspect it. The conversation artifacts showed it reached `r/test/new`, found about 50 post title elements, and then attempted a DOM `evaluate` extraction path. The failure is more accurately described as a stalled duplicate-evidence producer while screenshot loops continued in the background.

There is an observability gap: screenshot telemetry stored the active workflow step inside `details_json.stepId`, but the top-level `telemetry_events.step_id` column was empty for the screenshot events. Also, file-write telemetry for `session.screenshot.rolling` was not visible in the queried affected sessions even though rolling capture allowance was recorded. The next Forge story should tighten this audit path so allowed capture, file write, cleanup, and step context are correlated.

## Blast Radius From Epicenter

### Ring 0: Epicenter

`workflows/post_to_reddit.yaml` lines 49-68 are the failing contract surface. The prompt asks an LLM-driven browser agent to combine navigation, infinite-feed collection, DOM extraction, scoring, navigation-back, and strict output formatting in one bounded five-step task.

### Ring 1: Direct Reddit Posting Workflow

The direct `post_to_reddit` workflow cannot proceed past duplicate evidence generation. The downstream `submit_reddit_post` gate still protects posting, so the defect prevents publication rather than causing unsafe posting.

The practical user impact is a workflow that appears alive but makes no visible progress after login.

### Ring 2: Browser-Use Bridge And Step Timeout Behavior

The Node workflow engine waits on the Python browser-use bridge for the task result. The bridge HTTP request has a long timeout, so the system can sit in a hung pre-submit evidence step for a long time before returning control.

Because the task does not return a final output, the direct workflow never reaches the parser that stores `reddit_duplicate_check_evidence` and `reddit_duplicate_check_result`.

### Ring 3: Persistence And Wrap-Up

Manual interruption before normal wrap-up means no `workflow_runs` row is written for the affected sessions. That removes the durable failure record that operators would expect for a production run.

This is a workflow lifecycle visibility issue, not a Reddit submission issue.

### Ring 4: Screenshot Retention And Storage

Rolling screenshots continue during the stalled running phase. The failed attempts produced new rolling screenshot files before they were manually purged.

US-039 reduces the long-term storage risk with retention cleanup and scavenging, but the immediate issue remains: a hung workflow can produce rolling artifacts until timeout or interruption.

The next Forge story should treat this as a specific runtime guardrail: when a single step remains stuck beyond a bounded threshold, rolling screenshots should stop, sharply throttle, or switch to a lower-retention heartbeat. This should not block legitimate evidence screenshots, but it should prevent a hung pre-submit task from generating unbounded debug frames.

### Ring 5: Related Workflow Family

`workflows/write_and_post_to_reddit.yaml` carries the same duplicate-check prompt shape at lines 57-74. It runs in `mode: agentic`, so the exact control path differs, but the same evidence-production fragility exists if that workflow is used before agentic retirement.

### Ring 6: Governance And Prior Story Scope

US-033 fixed the earlier circular-block problem where the duplicate-check step was incorrectly blocked before it could produce evidence. This incident does not reopen that fix. The classifier allowed the step correctly.

This is a new runtime determinism gap: duplicate evidence production is too important to leave to a broad LLM/browser-use prompt.

## Not Implicated

- App startup and the persistent serve process.
- Reddit authentication HITL handoff.
- The US-033 evidence-producing read-only classifier.
- The `submit_reddit_post` safety gate.
- The final evidence screenshot persistence sanitizer from US-037.
- The US-038 screenshot capture policy gate.
- The US-039 retention cleanup model, except as adjacent mitigation for artifacts created during hung runs.

## Recommended Fix Shape

Create a new Forge story for a deterministic Reddit duplicate evidence producer.

The implementation should move duplicate-check evidence generation out of `browser-use` and into a deterministic TypeScript/Playwright path:

- Navigate to `/r/{subreddit}/new`.
- Read the first bounded set of visible post titles with stable DOM selectors.
- Compute word-level Jaccard scores in TypeScript.
- Store the existing evidence contract: extracted titles, overlap scores, duplicate result, and matching title when applicable.
- Navigate back to `/r/{subreddit}/submit`.
- Keep the existing `submit_reddit_post` gate unchanged.

Secondary hardening should add:

- A shorter per-agent-task timeout for pre-submit evidence production.
- An interrupted-run cleanup path so aborted workflows do not disappear without a durable failure record.
- A screenshot-loop guard so rolling debug capture stops or throttles when a single step is stuck.
- Telemetry correlation from screenshot decision through file write and cleanup using the top-level `step_id` where possible.

## Current Operational Recommendation

Do not run another live Reddit posting workflow until the duplicate-check evidence producer is deterministic or the workflow is temporarily patched to use a bounded non-LLM duplicate-check step.

## Next Forge Story Inputs

The next Forge story should carry both halves of this finding:

1. Replace the Reddit duplicate-check evidence producer with a deterministic bounded implementation.
2. Add hung-step screenshot guardrails so a stuck task cannot create excessive rolling debug screenshots.

The story should preserve the existing fail-closed submit gate and the existing duplicate-check evidence contract.

## Screenshot Timing Fine-Tuning Inputs

The next Forge story should also account for screenshot timing collision risks. The current collision surface is narrower than "every screenshot path reads and writes files," because UI live screenshots and `/api/screenshot` return fresh `page.screenshot()` bytes and do not read persisted screenshot files. However, they still compete for Playwright screenshot encoding time, and the rolling/workflow/step-scoped paths do perform synchronous filesystem writes and deletes.

Corrected risk map:

| Risk | Current shape | Story impact |
| --- | --- | --- |
| Concurrent screenshot encoding | UI push every 1200ms, rolling capture every 5000ms, on-demand UI/MCP, workflow evidence, and browser-use action screenshots can overlap. | Add capture serialization or a low-priority queue so redundant live/debug captures do not spike latency during a workflow step. |
| Step-scoped cleanup collision | `handleStepAdvance(...)` deletes `sessions/step-scoped/*` while a redacted step-scoped capture could still be completing. | Add retry-with-backoff and avoid removing in-memory tracking until deletion is verified or recorded as failed. |
| Rolling debug file growth | A hung step keeps the rolling timer active and writing `sessions/rolling/*.jpg`. | Stop/throttle rolling debug capture when one step exceeds a bounded duration. |
| Workflow evidence retention | Evidence screenshots in `sessions/workflow/*` are skipped by wrap-up cleanup when class is `evidence` or retention is `keep_until_manual_review`. | Preserve this rule; TTL cleanup must not delete evidence awaiting review. |
| Startup cleanup latency | Startup scavenger runs after session start through `setImmediate(...)` and scans a bounded batch of 100 rolling files by default. | Keep bounded batches, but consider async/background cleanup if backlog growth is observed. |
| Audit/source-of-truth mismatch | Files can exist without audit rows after interrupted runs or failed persistence. | Scavenger should default unknown screenshot files to the restrictive cleanup path unless explicitly indexed as evidence. |

The strongest immediate mitigation is not a broad file lock. It is a small screenshot capture scheduler:

- Collapse duplicate live-frame requests while one capture is already in flight.
- Give explicit workflow evidence screenshots priority over UI live frames and rolling debug frames.
- Pause or throttle rolling debug capture during long-running single-step stalls.
- Add retry-with-backoff for unlink operations, with failed deletion retained in `screenshot_cleanup_failures`.
- Preserve evidence rows and content hashes as the durable source of truth for screenshots kept for review.

## Post-Task TTL Retention Update

The next Forge story should move successful-run rolling/debug cleanup into a short post-task TTL window instead of deleting immediately during wrap-up.

Required behavior:

| Trigger point | Condition | Action |
| --- | --- | --- |
| Workflow completion | `workflow_result == success` | Schedule a `120000ms` post-task cleanup timer for rolling/debug screenshots. |
| TTL expiry | Timer reaches zero and session still qualifies | Delete `sessions/rolling/*.jpg` and eligible `debug_frame` files; record cleanup telemetry and failures. |
| Failure or abort | `workflow_result != success` or no durable success row exists | Keep debug frames under the fallback `ttl_24h` startup scavenger policy unless another explicit cleanup rule applies. |
| Process restart during TTL | Prior timer was lost | Startup cleanup treats successful-run rolling/debug artifacts older than `120s` as expired and eligible for immediate cleanup. |

The current implementation does not fully provide this shape. `cleanupWorkflowScreenshotsOnWrapUp(...)` only iterates `input.result.screenshots`, while rolling frames are written directly by `SessionManager.startScreenshotTimer(...)` into `sessions/rolling/` and are not added to `WorkflowResult.screenshots`. Therefore, the next story must explicitly include rolling-directory cleanup and cannot rely only on the workflow result screenshot list.

Post-task TTL tradeoff:

- It improves observability by preserving the last rolling/debug frames briefly for post-run verification and automated scraping.
- It reduces wrap-up I/O pressure by moving cleanup out of the critical persistence path.
- It weakens data minimization for 120 seconds, so sensitive-phase blocking/redaction and evidence classification must remain enforced before capture.

Concurrency requirements:

- Stop the rolling timer before scheduling the success TTL cleanup.
- Keep UI live-frame transport independent, because it does not read persisted rolling files.
- Avoid deleting evidence screenshots or any file indexed as `keep_until_manual_review`.
- Add retry-with-backoff around unlink operations.
- Keep failed deletion rows in `screenshot_cleanup_failures`.
- Emit `session.cleanup.scheduled`, `session.cleanup.completed`, and `session.cleanup.failed` style telemetry without image bytes.

The recommended implementation is a per-session cleanup scheduler with persistent recovery:

- In-memory `setTimeout` for the 120s happy path.
- Startup scavenger recovery for successful run artifacts whose session completed more than 120s ago.
- Fallback `ttl_24h` for failed, aborted, or unknown-session rolling/debug files.
- SQLite success state as the source of truth when deciding whether a recovered timer should delete immediately or preserve debug files.

## Deterministic Reddit Duplicate Check Definition

The next Forge story should replace the browser-use duplicate-check prompt with a deterministic title collector and scorer. Preserve the existing evidence contract and submit gate, but define the implementation details explicitly.

### Thresholds

Use word-level Jaccard similarity after title normalization.

| Score range | Classification | Submit behavior |
| --- | --- | --- |
| `>= 0.70` | `DUPLICATE_RISK` | Block `submit_reddit_post`; include `MATCHING_TITLE`. |
| `>= 0.50` and `< 0.70` | `NEAR_MATCH_REVIEW` metadata only | Do not block submit under the existing contract; include the score in `OVERLAP_SCORES` for operator visibility. |
| `< 0.50` | `NO_DUPLICATE_FOUND` | Allow the submit gate if the evidence contract is otherwise valid. |

The canonical output line must remain `DUPLICATE_CHECK_RESULT: NO_DUPLICATE_FOUND` or `DUPLICATE_CHECK_RESULT: DUPLICATE_RISK` so existing parser and submit-gate behavior stay compatible. `NEAR_MATCH_REVIEW` is a derived metadata concept for telemetry/tests, not a third output value.

### Normalization

Normalize candidate and observed titles before scoring:

- Convert to lowercase.
- Trim leading/trailing whitespace.
- Collapse internal whitespace.
- Strip punctuation except alphanumeric word boundaries.
- Split on whitespace.
- Remove empty tokens.
- Deduplicate tokens before Jaccard calculation.

Jaccard formula:

```text
score = size(intersection(candidate_tokens, observed_tokens)) / size(union(candidate_tokens, observed_tokens))
```

If both token sets are empty, score `0.0`.

### DOM Selector Strategy

Primary selector:

```css
a[id^="post-title-"]
```

This selector is supported by the failed-run browser-use artifacts, which found around 50 Reddit post title elements with IDs like `post-title-t3_...`.

Fallback selectors, evaluated in order only if the prior selector returns no usable titles:

```css
shreddit-post a[id^="post-title-"]
article a[id^="post-title-"]
[data-testid="post-title"]
h1, h2, h3
```

Extraction rules:

- Collect text using `textContent`.
- Trim each title.
- Drop empty strings.
- Drop obvious non-title UI labels such as `comment`, `comments`, `share`, `vote`, `promoted`, and `advertisement` when they appear as standalone title candidates.
- Deduplicate titles case-insensitively while preserving first-seen display text.
- Bound collection to the first `50` usable titles.
- Do not infinite-scroll. At most one initial page load plus one bounded scroll-and-retry is allowed if zero titles are found.

### Failure Behavior

If no usable titles are collected after the selector fallback path:

- Return a failed step, not `NO_DUPLICATE_FOUND`.
- Emit telemetry with selector counts and current URL.
- Do not allow `submit_reddit_post`, because the duplicate evidence contract is missing.

This fail-closed behavior is intentional: a DOM drift should block posting rather than silently claim no duplicate was found.

## Capture Scheduler And Jaccard Complexity Fine-Tuning

The Reddit incident and screenshot timing audit both point to a coordinated scheduler requirement. The current architecture can produce three separate overhead classes during a stalled workflow step:

- Capture-encoding contention from overlapping `page.screenshot()` calls: UI live frames, rolling debug frames, on-demand UI/MCP screenshots, workflow evidence screenshots, and browser-use action screenshots.
- Synchronous filesystem pressure from rolling, workflow evidence, and step-scoped screenshot writes/deletes.
- Step-scoped deletion collisions when `handleStepAdvance(...)` deletes prior step-scoped files while a redacted capture may still be completing.

The next Forge story should implement a screenshot capture scheduler with:

- Request collapsing for duplicate live-frame requests while a capture is already in flight.
- Priority queueing where explicit workflow evidence screenshots outrank UI live frames and rolling debug frames.
- Hung-step guardrail that pauses or sharply throttles rolling debug capture when one step exceeds a bounded duration without progress.
- Retry-with-backoff for unlink operations before clearing in-memory step-scoped tracking.
- 120s post-success TTL cleanup for rolling/debug artifacts so deletion I/O moves out of the wrap-up critical path.

The deterministic Reddit duplicate check should not introduce meaningful computational lag if bounded as specified.

Complexity target:

```text
n = number of collected titles, bounded to 50
m = average normalized token count per title
c = normalized candidate token count

normalization: O(n * m + c)
scoring:       O(n * (m + c))
sorting/top:   O(n log n) if scores are sorted, or O(n) if preserving input order
memory:        O(n * m)
```

With `n <= 50`, this is operationally small. The dominant cost should remain DOM access and page navigation, not Jaccard scoring. To keep that true:

- Do not infinite-scroll.
- Do not score more than `50` usable titles.
- Do not perform pairwise title-to-title comparisons; only candidate title versus observed titles.
- Prefer one `page.evaluate(...)` extraction pass over repeated locator calls when selectors are stable.
- Emit score telemetry as counts/max score/matching title only, not large debug payloads.

The deterministic duplicate check and screenshot scheduler should be a single Forge story or tightly sequenced sibling stories, because the failed Reddit step triggered the screenshot blast radius while stalled.
