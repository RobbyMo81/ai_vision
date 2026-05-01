# Live Workflow Prompt Contract Regression Suite — Implementation Handoff

Story: `US-033`
Tracker Row: `RF-015`
Source Debrief: `docs/debriefs/2026-04-28-us031-agent-task-dominant-intent-drift.md`
Source Storyline: `docs/artifacts/2026-04-30-us033-rf015-live-prompt-contract-regression-storyline.md`
Source Story Card: `docs/artifacts/2026-04-30-us033-rf015-live-prompt-contract-regression-forge-story.yaml`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the debrief, storyline, YAML story card, definition of done, US-031 handoff, US-032 handoff, and HITL gate quick reference before code changes.
2. Read `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, and `workflows/post_to_reddit.yaml`.
3. Keep this story focused on live workflow prompt contract coverage and the duplicate-check evidence-producer safety seam.
4. Preserve `mode: agentic`.
5. Record the Summary of Work in `progress.txt`, then update PRD, tracker, and Forge history after validation passes.
6. Append the story narrative to `docs/history/forge_history.md` and one library-card row to `docs/history/history_index.md`.
7. Keep `AGENTS.md` free of long-form story payloads.

## Task

Fix the live prompt contract gap that lets `check_duplicate_reddit_post` become circularly blocked by the duplicate-evidence safety gate.

The implementation must:

1. Add exact live prompt fixtures.
   - Load `workflows/post_to_reddit.yaml` in `src/workflow/engine.test.ts`.
   - Extract the exact `agent_task` prompt for `check_duplicate_reddit_post`.
   - Extract the exact `agent_task` prompt for `submit_reddit_post`.
   - Do not edit the workflow file to make tests pass.

2. Protect evidence-producing read-only duplicate checks.
   - Treat `check_duplicate_reddit_post` as an evidence-producing read-only step.
   - Let that step execute before `reddit_duplicate_check_evidence` exists.
   - Record classifier details that show why the step was treated as evidence-producing read-only work.
   - Keep this allowance narrow and deterministic.

3. Keep submit protection strict.
   - Keep `submit_reddit_post` classified as submit.
   - Keep missing duplicate evidence as a hard block for `submit_reddit_post`.
   - Keep duplicate-risk evidence as a hard block for `submit_reddit_post`.
   - Allow submit dispatch only when valid no-duplicate evidence exists.

4. Preserve existing direct gates.
   - Preserve US-028 duplicate evidence parsing and submit gating.
   - Preserve US-031 side-effect safety checks.
   - Preserve US-032 dominant-intent ranking.
   - Preserve content validation, approval gating, precondition gating, browser postconditions, final HITL confirmation, and telemetry.

5. Add traceable telemetry details.
   - Keep `workflow.agent_task_side_effect.evaluated`.
   - Include selected intent and matched signals for the exact live prompts.
   - Add enough detail to distinguish evidence-producing read-only allowance from protected submit allowance.
   - Keep blocked telemetry for invalid submit paths.

## Required Code Surfaces

1. [`src/workflow/engine.ts`](/home/spoq/ai-vision/src/workflow/engine.ts) — classifier and `agent_task` safety behavior
2. [`src/workflow/engine.test.ts`](/home/spoq/ai-vision/src/workflow/engine.test.ts) — exact live prompt contract tests
3. [`workflows/post_to_reddit.yaml`](/home/spoq/ai-vision/workflows/post_to_reddit.yaml) — read as fixture, not patched as a workaround

## Required Tests

- Exact live `check_duplicate_reddit_post` prompt is loaded from `workflows/post_to_reddit.yaml`.
- Exact live `check_duplicate_reddit_post` prompt can run before duplicate evidence exists.
- Exact live `check_duplicate_reddit_post` prompt records evidence-producing read-only details.
- Exact live `submit_reddit_post` prompt still selects `submit`.
- Exact live `submit_reddit_post` prompt without duplicate evidence is blocked.
- Exact live `submit_reddit_post` prompt with valid no-duplicate evidence can reach worker dispatch.
- Duplicate-risk evidence still blocks submit.
- Duplicate-check output parsing still writes `reddit_duplicate_check_evidence`, `reddit_duplicate_check_result`, and `reddit_duplicate_matching_title`.
- Evaluated telemetry includes selected intent and matched signals for live prompts.
- Existing `US-028` through `US-032` tests still pass.
- `mode: agentic` routing remains unchanged.

## Acceptance Criteria

- Live YAML prompt fixtures are part of regression coverage.
- The duplicate-check evidence producer is not blocked by its own missing evidence.
- Submit remains protected by valid duplicate evidence.
- No workflow YAML is patched as a workaround.
- Approval, content, duplicate-evidence, precondition, browser postcondition, HITL, telemetry, and agentic behavior do not regress.
- `pnpm run typecheck` passes.
- `pnpm test` passes.

## Implementation Notes

- Keep the allowance for evidence-producing read-only work narrow.
- Prefer step identity plus deterministic evidence-contract signals over broad prompt text exceptions.
- Do not create a general bypass for prompts that mention `/submit`.
- Do not weaken Reddit submit protection.
- Do not modify Python/browser-use internals.
- Do not replace final HITL confirmation.
- Do not remove `mode: agentic`.
