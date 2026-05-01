# Live Workflow Prompt Contract Regression Suite

Story: `US-033`
Tracker Row: `RF-015`
Date: `2026-04-30`

## Problem

The direct Reddit workflow is blocked by a second live-prompt classifier drift after `US-032`.

`US-032` fixed the original `submit_reddit_post` dominant-intent drift. The next supervised run exposed a different prompt-contract failure:

- `check_duplicate_reddit_post` is the evidence-producing, read-only step.
- Its live prompt mentions `/submit` and `before posting to Reddit`.
- The `agent_task` safety gate can classify that prompt as protected Reddit submit intent.
- The duplicate-evidence safety check then requires evidence before the evidence-producing step can run.

This creates a circular block before Reddit submit is reachable.

## Why This Story Exists

The direct workflow kernel must test exact production YAML prompts as safety-policy contracts. Simplified prompt fixtures are not enough once prompt text participates in deterministic side-effect classification.

`US-033` turns live workflow prompts into regression fixtures and adds a deterministic safe path for evidence-producing read-only duplicate-check steps.

## Scope

This is an implementation story.

It must:

- add regression coverage that loads exact prompts from live workflow YAML files
- cover `workflows/post_to_reddit.yaml` `check_duplicate_reddit_post`
- cover `workflows/post_to_reddit.yaml` `submit_reddit_post`
- prove the duplicate-check step can run without pre-existing duplicate evidence
- prove the submit step still requires valid duplicate evidence
- preserve `US-031` side-effect safety
- preserve `US-032` dominant-intent behavior
- preserve `US-028` duplicate-evidence enforcement before submit
- preserve browser postcondition checks after protected execution
- preserve `mode: agentic`

It must not:

- patch workflow prompts to make tests pass
- weaken Reddit submit evidence requirements
- bypass approval, content, duplicate, precondition, browser postcondition, or HITL gates
- change Python/browser-use internals
- remove `agent_task`
- remove `mode: agentic`

## Source Evidence

- `docs/debriefs/2026-04-28-us031-agent-task-dominant-intent-drift.md`
- `workflows/post_to_reddit.yaml`
- `src/workflow/engine.ts`
- `src/workflow/engine.test.ts`
- `docs/artifacts/2026-04-28-us031-rf013-agent-task-side-effect-safety-implementation-handoff.md`
- `docs/artifacts/2026-04-28-us032-rf014-agent-task-dominant-intent-implementation-handoff.md`

## Outcome Required

At the end of this story:

- the exact live duplicate-check prompt is covered by regression tests
- `check_duplicate_reddit_post` is treated as evidence-producing read-only work
- `check_duplicate_reddit_post` can execute before duplicate evidence exists
- `submit_reddit_post` remains protected as submit intent
- `submit_reddit_post` remains blocked when duplicate evidence is missing
- valid duplicate evidence allows submit to reach worker dispatch
- classifier telemetry identifies selected intent and matched signals
- safety telemetry distinguishes evidence-producing read-only allowance from submit protection
- `post_to_reddit.yaml` remains unchanged
- typecheck and tests pass
