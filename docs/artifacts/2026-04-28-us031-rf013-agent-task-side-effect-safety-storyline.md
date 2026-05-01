# Agent Task Side-Effect Safety Gate

Story: `US-031`
Tracker Row: `RF-013`
Date: `2026-04-28`

## Problem

The direct workflow engine now has deterministic gates for HITL publication, confirmation binding, return-control binding, approval, output validation, Reddit duplicate evidence, browser postconditions, and precondition skips.

The remaining execution-safety gap is `agent_task`.

`agent_task` can route prompt-driven work to Python/browser-use through `routeAgentTask(...)` and the engine registry. That gives the workflow flexibility, but it also creates a broad tool boundary where prompt text can imply submit, publish, click, navigate, fill, login, and verification actions.

The direct engine must prove that `agent_task` cannot bypass the gate stack when the prompt implies protected browser side effects.

## Why This Story Exists

`US-031` closes the last approved atlas-aligned HITL gate story in the current sequence.

The goal is not to remove `agent_task`. The goal is to classify side-effect intent before dispatch and require the same direct-path safety evidence that explicit steps require.

## Scope

This is an implementation story.

It must:

- add a deterministic `agent_task` side-effect safety boundary before worker dispatch
- classify `agent_task` prompts into protected and unprotected categories
- require direct approval evidence before protected `agent_task` side effects
- require required content/output evidence before posting-style `agent_task` side effects
- require Reddit duplicate evidence before Reddit submit-style `agent_task` side effects
- preserve browser postcondition validation after `agent_task` side effects
- emit structured side-effect safety telemetry
- add regression tests proving `agent_task` cannot bypass the gate stack
- preserve `mode: agentic`

It must not:

- remove `agent_task`
- rewrite Python/browser-use internals
- replace approval gating
- replace precondition gating
- replace browser postconditions
- remove `mode: agentic`

## Source Evidence

- `docs/artifacts/2026-04-24-direct-workflow-gate-layer-design.md`
- `docs/architecture/as-built_execution_atlas.md`
- `docs/debriefs/2026-04-26-hitl-gate-story-reference.md`
- `src/workflow/engine.ts`
- `src/workflow/types.ts`
- `src/workflow/engine.test.ts`
- `workflows/post_to_reddit.yaml`
- `workflows/write_and_post_to_reddit.yaml`

## Outcome Required

At the end of this story:

- protected `agent_task` prompts are classified before dispatch
- posting-style `agent_task` prompts cannot run without approval and required evidence
- Reddit submit-style `agent_task` prompts cannot run without duplicate evidence
- browser postconditions still validate after protected `agent_task` execution
- safety decisions are visible through telemetry
- direct-path tests prove prompt-driven execution cannot bypass gates
- typecheck and tests pass
