# Reddit Duplicate-Check Deterministic Evidence Gate — Definition Of Done

Story: `US-028`
Tracker Row: `RF-010`

The story is done only when all of the following are true:

1. Reddit duplicate-check prompts use the evidence contract:
   - `DUPLICATE_CHECK_RESULT: NO_DUPLICATE_FOUND`
   - `DUPLICATE_CHECK_RESULT: DUPLICATE_RISK`
   - `EXTRACTED_TITLES: <json array>`
   - `OVERLAP_SCORES: <json array>`
   - `MATCHING_TITLE: <title>` for duplicate risk

2. The direct engine parses duplicate-check evidence:
   - result
   - extracted titles
   - overlap scores
   - matching title
   - validation errors

3. The direct engine stores evidence outputs:
   - `reddit_duplicate_check_evidence`
   - `reddit_duplicate_check_result`
   - `reddit_duplicate_matching_title` when present

4. The direct engine validates evidence before `submit_reddit_post`:
   - missing evidence blocks submit
   - missing extracted titles blocks submit
   - missing overlap scores blocks submit
   - invalid score outside `0..1` blocks submit
   - score `>= 0.70` blocks submit unless result is duplicate risk
   - `DUPLICATE_RISK` blocks submit

5. Telemetry exists:
   - `workflow.reddit_duplicate_check.evidence_parsed`
   - `workflow.reddit_duplicate_check.evidence_failed`
   - `workflow.reddit_duplicate_check.duplicate_risk`
   - events include workflow id, session id, step id, subreddit, candidate title, extracted title count, max score, and matching title

6. Regression tests cover:
   - valid no-duplicate evidence allows submit path
   - duplicate-risk evidence blocks submit path
   - missing evidence blocks submit
   - missing extracted titles blocks submit
   - missing overlap scores blocks submit
   - invalid score blocks submit
   - score threshold mismatch blocks submit
   - evidence outputs are written
   - telemetry pass and fail paths
   - existing `US-027` tests still pass
   - `mode: agentic` routing remains unchanged

7. Quality gates:
   - `pnpm run typecheck` exits `0`
   - `pnpm test` exits `0`

8. Forge evidence trail:
   - storyline artifact exists
   - YAML story card exists
   - implementation handoff exists
   - this definition-of-done artifact exists
   - `RF-010` row is updated to `Completed`
   - `US-028` has `passes: true`
   - `progress.txt` records a Summary of Work entry
   - `docs/history/forge_history.md` records the full story result
   - `docs/history/history_index.md` records one library-card row
   - `AGENTS.md` is not used for the long-form story entry
