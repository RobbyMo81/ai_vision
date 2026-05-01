# Reddit Duplicate-Check Deterministic Evidence Gate

Story: `US-028`
Tracker Row: `RF-010`
Date: `2026-04-27`

## Problem

The supervised `post_to_reddit` run completed and posted successfully to `r/test`, but the duplicate-check step was process-weak.

Source evidence:

- workflow: `post_to_reddit`
- session: `f378ab06-8636-4171-a32e-8a772af23e1e`
- post URL: `https://www.reddit.com/r/test/comments/1sxm1nu/aivision_workflow_update_hitl_approval_gates_are/`
- weak step: `check_duplicate_reddit_post`
- browser-use judge warning: the agent returned `NO_DUPLICATE_FOUND` without deterministic extracted-title evidence and similarity scoring

The current duplicate check relies on prompt instructions:

- navigate to `reddit.com/r/{{subreddit}}/new`
- scan visible posts for any title with `>70%` overlap
- return `DUPLICATE_RISK: <matching title>` or `NO_DUPLICATE_FOUND`

That is not enough for a production side-effect gate. Before a Reddit submit step can execute, the direct engine needs structured duplicate-check evidence.

## Why This Story Exists

`US-027` validates generated content. It does not prove that the content is not a duplicate of recent subreddit posts.

`US-028` adds the second data-integrity gate:

1. duplicate-check output must include extracted visible titles
2. duplicate-check output must include deterministic overlap scores
3. the engine must store and validate the evidence before Reddit submit
4. missing evidence must block submit
5. duplicate risk must fail fast before submit

## Scope

This is an implementation story.

It must:

- add a deterministic Reddit duplicate-check evidence contract
- update Reddit duplicate-check workflow steps to request structured evidence
- parse duplicate-check output into evidence
- validate evidence before `submit_reddit_post`
- emit duplicate-check telemetry
- fail fast on duplicate risk
- fail fast on missing evidence
- preserve approval, content validation, and return-control gates
- add regression tests
- preserve `mode: agentic`

It must not:

- implement generic browser postconditions
- implement generalized precondition skip gates
- implement full `agent_task` side-effect policy
- remove `mode: agentic`
- automate deletion of existing Reddit posts

## Source Evidence

- `docs/debriefs/2026-04-26-hitl-gate-story-reference.md`
- `docs/debriefs/AI_VISION_V2_BLUEPRINT.md`
- `workflows/post_to_reddit.yaml`
- `workflows/write_and_post_to_reddit.yaml`
- `src/workflow/engine.ts`
- `src/workflow/types.ts`
- `src/workflow/engine.test.ts`
- `src/session/types.ts`

## Outcome Required

At the end of this story:

- Reddit duplicate-check output is structured and evidence-backed
- evidence includes extracted visible titles and overlap scores
- `DUPLICATE_RISK` fails before submit
- missing evidence fails before submit
- valid `NO_DUPLICATE_FOUND` evidence allows submit path to continue
- telemetry records duplicate-check evidence decisions
- typecheck and tests pass
