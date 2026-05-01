# Backlog Reconciliation: US-012, US-020, US-021 — Implementation Handoff

Story: `US-034`
Tracker Row: `RF-016`
Source Storyline: `docs/artifacts/2026-05-01-us034-rf016-backlog-reconciliation-storyline.md`
Source Story Card: `docs/artifacts/2026-05-01-us034-rf016-backlog-reconciliation-forge-story.yaml`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the storyline, YAML story card, the HITL gate backlog reference, `prd.json`, tracker, `progress.txt`, and FORGE history before changing any files.
2. Verify the current evidence for `US-012`, `US-020`, and `US-021` from source files, tests, debriefs, and story artifacts.
3. Keep this story focused on backlog reconciliation and naming/status alignment.
4. Record the Summary of Work in `progress.txt`, then update PRD, tracker, and Forge history after the reconciliation decisions are validated.
5. Append the story narrative to `docs/history/forge_history.md` and one library-card row to `docs/history/history_index.md`.
6. Keep `AGENTS.md` free of long-form story payloads.

## Task

Reconcile the stale backlog state for `US-012`, `US-020`, and `US-021` in one governed story.

The implementation must:

1. Reconcile `US-012`.
   - Verify the browser-use live event bridge against current source, tests, progress, and history.
   - If the acceptance criteria are satisfied, close `US-012` with evidence.
   - If not, record the exact unmet acceptance item instead of silently closing it.

2. Reconcile `US-020`.
   - Decide whether the diagnostic baseline story is `archived-complete` or `retired`.
   - Base the decision on the bug report, YAML artifact, progress log, and later Node 24/typecheck evidence.
   - Keep the reasoning explicit so the story is not reopened by naming ambiguity.

3. Reconcile `US-021`.
   - Decide whether the remediation protocol is complete with existing artifacts, needs one missing remediation report, or should be retired as superseded.
   - If one concise missing artifact is the only blocker and the evidence already exists, add that artifact in this story instead of creating a separate implementation story.
   - If the story is superseded, record the superseding evidence and close it explicitly.

4. Fix governance naming drift.
   - Align `prd.json`, tracker rows, progress wording, and FORGE history naming for `US-012`, `US-020`, and `US-021`.
   - Remove or rewrite stale references that would cause a future agent to reopen already-reconciled work.
   - Preserve append-only story history; do not delete evidence.

5. Keep the scope narrow.
   - Do not create three follow-on implementation stories.
   - Do not reopen unrelated direct-gate work.
   - Do not change runtime code unless a claimed completed story is proven false and minimal validation is required.

## Required Code Surfaces

1. [prd.json](/home/spoq/ai-vision/prd.json)
2. [docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md](/home/spoq/ai-vision/docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md)
3. [progress.txt](/home/spoq/ai-vision/progress.txt)
4. [docs/history/forge_history.md](/home/spoq/ai-vision/docs/history/forge_history.md)
5. [docs/history/history_index.md](/home/spoq/ai-vision/docs/history/history_index.md)
6. [docs/debriefs/2026-04-26-hitl-gate-story-reference.md](/home/spoq/ai-vision/docs/debriefs/2026-04-26-hitl-gate-story-reference.md)

## Required Validation

- `jq empty prd.json` passes.
- The final US-012 decision cites current source/test/history evidence.
- The final US-020 decision cites the bug report and supporting artifacts.
- The final US-021 decision cites remediation artifacts or a supersession rationale.
- Updated tracker/history wording uses the same story names as PRD for the reconciled items.

## Acceptance Criteria

- `US-012` is explicitly closed with evidence or left open with one concrete unmet acceptance item.
- `US-020` is explicitly classified as archived-complete or retired.
- `US-021` is explicitly classified as completed or retired as superseded.
- PRD, tracker, progress, and FORGE history use aligned names for these stories.
- No separate implementation stories are created for this backlog cleanup.

## Implementation Notes

- Prefer explicit decision labels such as `complete-with-evidence`, `archived-complete`, `retired`, or `superseded` in the reconciliation write-up.
- If `US-021` only lacks a concise remediation report while the evidence already exists, add that one artifact inside this story rather than spinning off more backlog.
- When history titles are wrong, correct the titles rather than introducing duplicate completion entries for the same story id.