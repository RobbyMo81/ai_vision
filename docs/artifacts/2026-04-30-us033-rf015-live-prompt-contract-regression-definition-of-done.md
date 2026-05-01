# Live Workflow Prompt Contract Regression Suite — Definition Of Done

Story: `US-033`
Tracker Row: `RF-015`

The story is done only when all of the following are true:

1. Live prompt fixtures exist:
   - tests load `workflows/post_to_reddit.yaml`
   - tests extract `check_duplicate_reddit_post`
   - tests extract `submit_reddit_post`
   - workflow YAML is not patched as a workaround

2. Duplicate-check evidence producer is safe:
   - exact live `check_duplicate_reddit_post` prompt can execute before duplicate evidence exists
   - classifier details identify the step as evidence-producing read-only work
   - the allowance is narrow and deterministic
   - no broad `/submit` prompt bypass is introduced

3. Submit protection remains strict:
   - exact live `submit_reddit_post` prompt selects submit
   - missing duplicate evidence blocks submit
   - duplicate-risk evidence blocks submit
   - valid no-duplicate evidence allows submit dispatch

4. Existing gates remain intact:
   - US-028 duplicate evidence parsing and submit gate still work
   - US-031 side-effect safety still works
   - US-032 dominant-intent ranking still works
   - approval, content validation, precondition, browser postcondition, HITL, and telemetry behavior do not regress
   - `mode: agentic` remains present and untouched

5. Telemetry exists:
   - evaluated telemetry includes selected intent for live prompts
   - evaluated telemetry includes matched signals for live prompts
   - evidence-producing read-only allowance is distinguishable from protected submit allowance
   - blocked telemetry remains present for invalid submit paths

6. Regression tests cover:
   - live duplicate-check prompt before evidence exists
   - live submit prompt without evidence
   - live submit prompt with valid evidence
   - duplicate-risk evidence block
   - duplicate-check evidence parse and output storage
   - classifier telemetry details
   - existing `US-028` through `US-032` tests
   - `mode: agentic` routing

7. Quality gates:
   - `pnpm run typecheck` exits `0`
   - `pnpm test` exits `0`

8. Forge evidence trail:
   - storyline artifact exists
   - YAML story card exists
   - implementation handoff exists
   - this definition-of-done artifact exists
   - `RF-015` row is updated to `Completed`
   - `US-033` has `passes: true`
   - `progress.txt` records a Summary of Work entry
   - `docs/history/forge_history.md` records the full story result
   - `docs/history/history_index.md` records one library-card row
   - `AGENTS.md` is not used for the long-form story entry
