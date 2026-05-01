# Browser Side-Effect/Postcondition Gate — Definition Of Done

Story: `US-029`
Tracker Row: `RF-011`

The story is done only when all of the following are true:

1. Postcondition metadata exists:
   - `expectedUrlAfter`
   - `requiredOutputIncludes`
   - `postconditionRequired`
   - side-effect step schemas accept the metadata

2. Direct engine validates postconditions:
   - after `executeStep(...)`
   - before downstream steps continue
   - for metadata-enabled side-effect steps
   - for `submit_reddit_post` by default

3. Reddit submit postcondition is enforced:
   - current URL must contain `/comments/`
   - output evidence must include a Reddit comments URL
   - failure stops before `confirm_reddit_post_visible`

4. Reddit draft postcondition is enforceable:
   - current URL remains on `/r/<subreddit>/submit`
   - configured output markers are present
   - failure stops before submit

5. Telemetry exists:
   - `workflow.browser_postcondition.passed`
   - `workflow.browser_postcondition.failed`
   - events include workflow id, session id, step id, step type, current URL, expected URL, reason, and details

6. Regression tests cover:
   - submit URL pass
   - submit URL fail
   - submit output evidence fail
   - draft URL pass
   - draft URL fail
   - required output evidence fail
   - downstream confirmation blocked after postcondition failure
   - pass telemetry
   - fail telemetry
   - existing `US-026`, `US-027`, and `US-028` tests still pass
   - `mode: agentic` routing remains unchanged

7. Quality gates:
   - `pnpm run typecheck` exits `0`
   - `pnpm test` exits `0`

8. Forge evidence trail:
   - storyline artifact exists
   - YAML story card exists
   - implementation handoff exists
   - this definition-of-done artifact exists
   - `RF-011` row is updated to `Completed`
   - `US-029` has `passes: true`
   - `progress.txt` records a Summary of Work entry
   - `docs/history/forge_history.md` records the full story result
   - `docs/history/history_index.md` records one library-card row
   - `AGENTS.md` is not used for the long-form story entry
