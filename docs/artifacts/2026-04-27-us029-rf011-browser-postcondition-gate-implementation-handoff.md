# Browser Side-Effect/Postcondition Gate — Implementation Handoff

Story: `US-029`
Tracker Row: `RF-011`
Source Storyline: `docs/artifacts/2026-04-27-us029-rf011-browser-postcondition-gate-storyline.md`
Source Story Card: `docs/artifacts/2026-04-27-us029-rf011-browser-postcondition-gate-forge-story.yaml`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the storyline, YAML story card, definition of done, gate-layer design, atlas, and HITL gate quick reference before code changes.
2. Read `src/workflow/types.ts`, `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `workflows/post_to_reddit.yaml`, and `workflows/write_and_post_to_reddit.yaml`.
3. Keep this story focused on postcondition validation after browser side effects.
4. Preserve `mode: agentic`.
5. Record the Summary of Work in `progress.txt`, then update PRD, tracker, and Forge history after validation passes.
6. Do not append long-form story history to `AGENTS.md`; append the story narrative to `docs/history/forge_history.md` and one library-card row to `docs/history/history_index.md`.

## Task

Implement browser side-effect postcondition validation in the direct workflow path.

The implementation must:

1. Add optional postcondition metadata in `src/workflow/types.ts`.
   - Add `expectedUrlAfter?: string`.
   - Add `requiredOutputIncludes?: string[]`.
   - Add `postconditionRequired?: boolean`.
   - Apply the fields to side-effect step schemas that can mutate browser state.

2. Add one validation helper in `src/workflow/engine.ts`.
   - Name it `validateBrowserPostcondition`.
   - Keep it local to `engine.ts`.
   - Accept step, step result, current URL, workflow outputs, runtime params, workflow id, and session id.
   - Return `valid`, `reason`, and `details`.

3. Run postcondition validation after side-effect steps return.
   - Run after `executeStep(...)`.
   - Run before downstream steps continue.
   - Apply to `agent_task`, `navigate`, `click`, `fill`, and `type` when postcondition metadata is present.
   - Apply to `submit_reddit_post` even when metadata is absent.
   - Apply to Reddit draft steps when metadata is present.

4. Enforce Reddit submit postcondition.
   - For `submit_reddit_post`, current URL must contain `/comments/`.
   - Output evidence must include a Reddit comments URL.
   - Failure stops the workflow before `confirm_reddit_post_visible`.

5. Enforce Reddit draft postcondition.
   - For `draft_reddit_post` and `prepare_and_focus_body`, current URL must remain on `/r/<subreddit>/submit`.
   - When required output evidence is configured, the step output must include expected title/body markers.

6. Emit structured telemetry.
   - Emit `workflow.browser_postcondition.passed`.
   - Emit `workflow.browser_postcondition.failed`.
   - Include workflow id, session id, step id, step type, current URL, expected URL, reason, and details.

7. Preserve existing gates.
   - Approval gate from `US-026` must still run.
   - Content validation from `US-027` must still run.
   - Duplicate evidence gate from `US-028` must still run.
   - Final HITL confirmation must remain unchanged.
   - Agentic routing must remain unchanged.

## Required Code Surfaces

1. [`src/workflow/types.ts`](/home/spoq/ai-vision/src/workflow/types.ts) — step metadata schema and interfaces
2. [`src/workflow/engine.ts`](/home/spoq/ai-vision/src/workflow/engine.ts) — postcondition helper and run-loop gate
3. [`src/workflow/engine.test.ts`](/home/spoq/ai-vision/src/workflow/engine.test.ts) — regression tests
4. [`workflows/post_to_reddit.yaml`](/home/spoq/ai-vision/workflows/post_to_reddit.yaml) — direct Reddit postcondition metadata
5. [`workflows/write_and_post_to_reddit.yaml`](/home/spoq/ai-vision/workflows/write_and_post_to_reddit.yaml) — workflow contract parity metadata

## Required Tests

- `submit_reddit_post` passes when current URL contains `/comments/` and output includes a comments URL.
- `submit_reddit_post` fails when current URL remains `/submit`.
- `submit_reddit_post` fails when output lacks comments URL evidence.
- `draft_reddit_post` passes when current URL remains subreddit submit page.
- `draft_reddit_post` fails when current URL leaves subreddit submit page.
- configured `requiredOutputIncludes` missing value fails postcondition.
- postcondition failure prevents `confirm_reddit_post_visible`.
- postcondition pass telemetry is emitted.
- postcondition failure telemetry is emitted.
- existing `US-026`, `US-027`, and `US-028` tests still pass.
- `mode: agentic` routing remains unchanged.

## Acceptance Criteria

- Side-effect steps can declare postcondition metadata.
- Direct engine validates postconditions after side-effect execution.
- Reddit submit cannot succeed unless URL and output evidence show `/comments/`.
- Reddit draft steps can enforce expected composer URL.
- Failed required postconditions stop the workflow.
- Postcondition telemetry is emitted for pass and fail decisions.
- Final HITL confirmation remains present.
- `mode: agentic` remains present and untouched.
- `pnpm run typecheck` passes.
- `pnpm test` passes.

## Implementation Notes

- Keep postcondition validation deterministic.
- Keep this story focused on post-side-effect evidence.
- Do not implement generalized skip gates.
- Do not implement full `agent_task` side-effect policy.
- Do not modify Python/browser-use internals.
- Do not replace final HITL confirmation.
- Do not remove `mode: agentic`.
