# agent_task Dominant Intent Classification Fix — Implementation Handoff

Story: `US-032`
Tracker Row: `RF-014`
Source Debrief: `docs/debriefs/2026-04-28-us031-agent-task-dominant-intent-drift.md`
Source Storyline: `docs/artifacts/2026-04-28-us032-rf014-agent-task-dominant-intent-storyline.md`
Source Story Card: `docs/artifacts/2026-04-28-us032-rf014-agent-task-dominant-intent-forge-story.yaml`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the debrief, storyline, YAML story card, definition of done, US-031 handoff, and HITL gate quick reference before code changes.
2. Read `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, and `workflows/post_to_reddit.yaml`.
3. Keep this story focused on dominant intent classification in `agent_task`.
4. Preserve `mode: agentic`.
5. Record the Summary of Work in `progress.txt`, then update PRD, tracker, and Forge history after validation passes.
6. Do not append long-form story history to `AGENTS.md`; append the story narrative to `docs/history/forge_history.md` and one library-card row to `docs/history/history_index.md`.

## Task

Fix `classifyAgentTaskSideEffect(...)` so it resolves dominant intent instead of returning the first matched protected verb.

The implementation must:

1. Update the classifier shape in `src/workflow/engine.ts`.
   - Keep the helper named `classifyAgentTaskSideEffect`.
   - Keep it deterministic.
   - Collect all matched intent signals before selecting `intentKind`.
   - Return `protectedIntent`, `intentKind`, `reason`, and `details`.
   - Add matched signal detail in `details`.

2. Implement dominant intent selection.
   - Select submit when submit language and fallback fill language are both present.
   - Select publish when publish language and fallback fill language are both present.
   - Select post when post language and fallback fill language are both present.
   - Select final_click when final-click language and fallback fill language are both present.
   - Keep standalone fill classified as fill.
   - Keep standalone login classified as login.
   - Keep read-only classified as read_only when no protected signal is present.

3. Use the live Reddit prompt as the primary fixture.
   - Load the exact `submit_reddit_post` prompt from `workflows/post_to_reddit.yaml`.
   - Test the prompt without editing the workflow file.
   - Assert selected intent is submit.
   - Assert matched signals include fill and submit.

4. Preserve US-031 safety behavior.
   - Reddit submit-style prompts still require duplicate evidence.
   - Posting-style prompts still require valid content evidence.
   - Login and standalone fill prompts still require approval evidence when protected by policy.
   - Browser postcondition checks still run after protected `agent_task` execution.

5. Preserve the production workflow.
   - Do not add `submit_reddit_post` to `require_human_approval_before` as a workaround.
   - Do not create temporary workflow mutations.
   - `post_to_reddit.yaml` must remain compatible without semantic patching.

6. Emit useful telemetry.
   - Keep `workflow.agent_task_side_effect.evaluated`.
   - Include selected `intentKind`.
   - Include matched intent signals.
   - Include selected dominant intent source in details.

## Required Code Surfaces

1. [`src/workflow/engine.ts`](/home/spoq/ai-vision/src/workflow/engine.ts) — classifier semantics and telemetry details
2. [`src/workflow/engine.test.ts`](/home/spoq/ai-vision/src/workflow/engine.test.ts) — regression tests with live prompt fixture
3. [`workflows/post_to_reddit.yaml`](/home/spoq/ai-vision/workflows/post_to_reddit.yaml) — read as fixture; do not patch as workaround

## Required Tests

- exact live `workflows/post_to_reddit.yaml` `submit_reddit_post` prompt classifies as submit.
- submit plus fallback fill prompt classifies as submit.
- standalone fill prompt classifies as fill.
- standalone login prompt classifies as login.
- duplicate-check read-only prompt classifies as read_only.
- Reddit submit-style prompt still blocks when duplicate evidence is missing.
- Reddit submit-style prompt with valid evidence can reach worker dispatch.
- protected submit still receives browser postcondition validation after dispatch.
- evaluated telemetry includes selected intent and matched signals.
- existing `US-026` through `US-031` tests still pass.
- `mode: agentic` routing remains unchanged.

## Acceptance Criteria

- Classifier resolves dominant intent from multiple matched signals.
- Live Reddit submit prompt selects submit, not fill.
- Fallback fill text inside submit/publish/post/final-click prompts does not override dominant intent.
- Standalone fill protection remains active.
- Standalone login protection remains active.
- Read-only prompts remain allowed when no protected signal is present.
- Reddit duplicate evidence gate remains active for submit-style prompts.
- Browser postcondition gate remains active after protected `agent_task` execution.
- Telemetry records matched signals and selected dominant intent.
- `post_to_reddit.yaml` is not patched as a workaround.
- `mode: agentic` remains present and untouched.
- `pnpm run typecheck` passes.
- `pnpm test` passes.

## Implementation Notes

- Keep the classifier conservative.
- Prefer deterministic signal ranking over first-match returns.
- Do not weaken US-031 safety gates.
- Do not modify Python/browser-use internals.
- Do not replace final HITL confirmation.
- Do not remove `mode: agentic`.
