# Reddit Duplicate-Check Deterministic Evidence Gate — Implementation Handoff

Story: `US-028`
Tracker Row: `RF-010`
Source Storyline: `docs/artifacts/2026-04-27-us028-rf010-reddit-duplicate-evidence-storyline.md`
Source Story Card: `docs/artifacts/2026-04-27-us028-rf010-reddit-duplicate-evidence-forge-story.yaml`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the storyline, YAML story card, definition of done, HITL gate quick reference, and `US-027` closeout before code changes.
2. Read `workflows/post_to_reddit.yaml`, `workflows/write_and_post_to_reddit.yaml`, `src/workflow/engine.ts`, `src/workflow/types.ts`, and `src/workflow/engine.test.ts`.
3. Keep this story focused on Reddit duplicate-check evidence before submit.
4. Preserve `mode: agentic`.
5. Record the Summary of Work in `progress.txt`, then update PRD, tracker, and Forge history after validation passes.
6. Do not append long-form story history to `AGENTS.md`; append the story narrative to `docs/history/forge_history.md` and one library-card row to `docs/history/history_index.md`.

## Task

Implement deterministic Reddit duplicate-check evidence before `submit_reddit_post`.

The implementation must:

1. Define one evidence contract for Reddit duplicate checks.
   - Required final line: `DUPLICATE_CHECK_RESULT: NO_DUPLICATE_FOUND` when no duplicate exists.
   - Required final line: `DUPLICATE_CHECK_RESULT: DUPLICATE_RISK` when duplicate risk exists.
   - Required evidence line: `EXTRACTED_TITLES: <json array of visible post titles>`.
   - Required evidence line: `OVERLAP_SCORES: <json array of objects with title and score>`.
   - Required evidence line for duplicate risk: `MATCHING_TITLE: <title>`.
   - Scores must be numeric values between `0` and `1`.
   - Duplicate risk threshold is `0.70`.

2. Update Reddit duplicate-check prompts.
   - Update `workflows/post_to_reddit.yaml`.
   - Update `workflows/write_and_post_to_reddit.yaml`.
   - Instruct browser-use to output the evidence contract exactly.
   - Keep the duplicate-check step id `check_duplicate_reddit_post`.

3. Parse duplicate-check evidence in `src/workflow/engine.ts`.
   - Add a local parser for the evidence contract.
   - Keep the parser deterministic.
   - Return parsed result, extracted titles, overlap scores, matching title, and validation errors.

4. Store parsed evidence.
   - Store the parsed duplicate evidence in `outputs.reddit_duplicate_check_evidence`.
   - Store the decision in `outputs.reddit_duplicate_check_result`.
   - Store the matching title in `outputs.reddit_duplicate_matching_title` when present.

5. Validate duplicate evidence before `submit_reddit_post`.
   - Before `submit_reddit_post` reaches `executeStep(...)`, require valid evidence from the same run.
   - Fail when evidence is missing.
   - Fail when extracted titles are missing.
   - Fail when overlap scores are missing.
   - Fail when any score is outside `0..1`.
   - Fail when result is `DUPLICATE_RISK`.
   - Fail when any score is `>= 0.70` and result is `NO_DUPLICATE_FOUND`.

6. Emit structured telemetry.
   - Emit `workflow.reddit_duplicate_check.evidence_parsed` after successful parsing.
   - Emit `workflow.reddit_duplicate_check.evidence_failed` for missing/invalid evidence.
   - Emit `workflow.reddit_duplicate_check.duplicate_risk` when risk blocks submit.
   - Include workflow id, session id, step id, subreddit, candidate title, extracted title count, max score, and matching title.

7. Preserve existing gates.
   - Content/output validation from `US-027` must still run.
   - Approval gate from `US-026` must still run.
   - Return-control binding from `US-025` must remain unchanged.
   - Agentic routing must remain unchanged.

## Required Code Surfaces

1. [`src/workflow/engine.ts`](/home/spoq/ai-vision/src/workflow/engine.ts) — parser, output storage, pre-submit validation gate, telemetry
2. [`src/workflow/engine.test.ts`](/home/spoq/ai-vision/src/workflow/engine.test.ts) — regression tests
3. [`workflows/post_to_reddit.yaml`](/home/spoq/ai-vision/workflows/post_to_reddit.yaml) — direct workflow duplicate-check prompt
4. [`workflows/write_and_post_to_reddit.yaml`](/home/spoq/ai-vision/workflows/write_and_post_to_reddit.yaml) — agentic workflow duplicate-check prompt contract

## Required Tests

- Valid `NO_DUPLICATE_FOUND` evidence with extracted titles and overlap scores allows submit path.
- `DUPLICATE_RISK` evidence blocks submit path.
- Missing duplicate evidence blocks `submit_reddit_post`.
- Missing extracted titles blocks `submit_reddit_post`.
- Missing overlap scores blocks `submit_reddit_post`.
- Score `>= 0.70` with `NO_DUPLICATE_FOUND` blocks `submit_reddit_post`.
- Invalid score outside `0..1` blocks `submit_reddit_post`.
- Parsed evidence is written to workflow outputs.
- Duplicate-check telemetry is emitted for parsed, failed, and duplicate-risk decisions.
- Existing `US-027` content validation tests still pass.
- `mode: agentic` routing remains unchanged.

## Acceptance Criteria

- Reddit duplicate-check prompts request structured evidence.
- Duplicate-check evidence is parsed deterministically.
- Valid no-duplicate evidence allows Reddit submit path.
- Duplicate-risk evidence blocks Reddit submit path.
- Missing/invalid evidence blocks Reddit submit path.
- Evidence and decisions are stored in workflow outputs.
- Duplicate-check telemetry is emitted for pass and fail paths.
- `mode: agentic` remains present and untouched.
- `pnpm run typecheck` passes.
- `pnpm test` passes.

## Implementation Notes

- Keep this as a Reddit-specific gate.
- Key the gate to `check_duplicate_reddit_post` and `submit_reddit_post`.
- Keep the threshold fixed at `0.70`.
- Store evidence as JSON string outputs so wrap-up and memory can persist them.
- Do not implement generic browser postconditions.
- Do not implement generalized skip gates.
- Do not implement full `agent_task` side-effect policy.
- Do not remove `mode: agentic`.
