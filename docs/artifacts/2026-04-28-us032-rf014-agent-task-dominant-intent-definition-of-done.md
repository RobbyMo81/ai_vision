# agent_task Dominant Intent Classification Fix — Definition Of Done

Story: `US-032`
Tracker Row: `RF-014`

The story is done only when all of the following are true:

1. Dominant classifier exists:
   - `classifyAgentTaskSideEffect(...)` remains local to `src/workflow/engine.ts`
   - classifier collects all matched intent signals before selecting final intent
   - classifier returns selected intent plus matched signal details
   - classifier remains deterministic

2. Live Reddit prompt is fixed:
   - exact live `workflows/post_to_reddit.yaml` `submit_reddit_post` prompt is tested
   - prompt selects `intentKind: submit`
   - matched signals include fill and submit
   - fallback fill wording does not trigger a fill-intent approval block

3. Existing safety remains intact:
   - standalone fill still classifies as fill
   - standalone login still classifies as login
   - read-only duplicate checks still classify as read_only
   - Reddit submit-style prompts still require duplicate evidence
   - posting-style prompts still require valid content evidence
   - browser postcondition validation still runs after protected `agent_task`

4. Workflow semantics are not patched around:
   - no temporary workflow mutation is used
   - `post_to_reddit.yaml` is not changed merely to satisfy classifier approval evidence
   - no new approval selector is added as a workaround for this drift

5. Telemetry exists:
   - `workflow.agent_task_side_effect.evaluated` includes selected intent
   - event details include matched intent signals
   - allowed and blocked telemetry remain compatible with US-031

6. Regression tests cover:
   - live Reddit submit prompt
   - submit plus fallback fill
   - standalone fill
   - standalone login
   - read-only duplicate check
   - Reddit submit missing duplicate evidence
   - Reddit submit valid duplicate evidence path
   - postcondition still runs after protected submit
   - telemetry matched signals
   - existing `US-026` through `US-031` tests still pass
   - `mode: agentic` routing remains unchanged

7. Quality gates:
   - `pnpm run typecheck` exits `0`
   - `pnpm test` exits `0`

8. Forge evidence trail:
   - storyline artifact exists
   - YAML story card exists
   - implementation handoff exists
   - this definition-of-done artifact exists
   - `RF-014` row is updated to `Completed`
   - `US-032` has `passes: true`
   - `progress.txt` records a Summary of Work entry
   - `docs/history/forge_history.md` records the full story result
   - `docs/history/history_index.md` records one library-card row
   - `AGENTS.md` is not used for the long-form story entry
