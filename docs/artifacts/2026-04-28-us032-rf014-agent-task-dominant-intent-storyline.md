# agent_task Dominant Intent Classification Fix

Story: `US-032`
Tracker Row: `RF-014`
Date: `2026-04-28`

## Problem

The US-031 `agent_task` safety gate is implemented and green under tests, but production-run pre-flight found a drift against the actual direct Reddit workflow prompt.

The live `workflows/post_to_reddit.yaml` `submit_reddit_post` prompt contains both:

- fallback fill wording: `If the Title or Body fields are empty, fill them`
- dominant submit wording: `STEP 3 - Submit`

The classifier in `src/workflow/engine.ts` checks `fill` before `submit`. This can classify the submit step as `fill`, then require approval evidence for a fill intent before the submit-specific safety path runs.

## Why This Story Exists

The direct workflow kernel must reason deterministically about the dominant step intent, not the first protected verb in a prompt.

`US-032` fixes the classifier semantics exposed by the US-031 production-run pre-flight drift investigation.

## Scope

This is an implementation story.

It must:

- update `classifyAgentTaskSideEffect(...)` to collect matched intent signals before selecting the final intent
- select dominant submit/publish/post/final-click intent over fallback fill text when both are present in the same prompt
- preserve standalone fill classification
- preserve standalone login classification
- preserve read-only classification
- preserve Reddit duplicate evidence enforcement for submit-style prompts
- preserve content evidence enforcement for posting-style prompts
- preserve browser postcondition validation after protected `agent_task`
- add regression tests using the exact live `submit_reddit_post` prompt from `workflows/post_to_reddit.yaml`
- preserve `mode: agentic`

It must not:

- weaken `US-031` protected intent safety
- patch temporary workflow files to make the run pass
- change Python/browser-use internals
- remove `agent_task`
- remove `mode: agentic`

## Source Evidence

- `docs/debriefs/2026-04-28-us031-agent-task-dominant-intent-drift.md`
- `workflows/post_to_reddit.yaml`
- `src/workflow/engine.ts`
- `src/workflow/engine.test.ts`
- `docs/artifacts/2026-04-28-us031-rf013-agent-task-side-effect-safety-implementation-handoff.md`

## Outcome Required

At the end of this story:

- the live direct Reddit submit prompt classifies as dominant `submit`
- fallback fill text inside a submit prompt does not override submit classification
- standalone fill prompts still classify as `fill`
- standalone login prompts still classify as `login`
- read-only duplicate-check prompts still classify as `read_only`
- telemetry exposes matched signals and selected dominant intent
- `post_to_reddit.yaml` can be tested unchanged after implementation
- typecheck and tests pass
