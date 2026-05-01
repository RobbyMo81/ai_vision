# Browser Side-Effect/Postcondition Gate

Story: `US-029`
Tracker Row: `RF-011`
Date: `2026-04-27`

## Problem

The direct workflow engine now has data-integrity gates before side effects:

- approval before protected steps
- content/output validation
- Reddit duplicate-check evidence

The remaining browser execution gap is postcondition validation after browser side effects complete. Python/browser-use can report success even when TypeScript has not verified the browser ended in the expected state.

Examples:

- submit step reports success but URL remains on `/submit`
- draft step reports success but title/body are not visible
- browser-use navigates away from the expected page
- final submit returns output text but no durable URL evidence
- step succeeds but required page fields are missing

Without a postcondition gate, the engine can trust prompt-dependent side effects without deterministic TypeScript-side validation.

## Why This Story Exists

`US-029` is the first execution-safety gate after the data-integrity batch.

The goal is not to replace browser-use. The goal is to make browser-use side effects accountable to declared deterministic evidence before the workflow continues.

## Scope

This is an implementation story.

It must:

- add direct-path browser postcondition metadata support
- add a postcondition validation helper in `src/workflow/engine.ts`
- validate expected URL after side-effect steps
- validate required output evidence after side-effect steps
- validate Reddit submit reaches a `/comments/` URL
- validate draft steps keep the workflow on the expected composer page
- emit structured postcondition telemetry
- fail fast when required postconditions are not met
- add regression tests
- preserve `mode: agentic`

It must not:

- implement generalized precondition skip gates
- implement full `agent_task` side-effect policy
- remove `mode: agentic`
- change Python/browser-use internals
- replace HITL final confirmation

## Source Evidence

- `docs/artifacts/2026-04-24-direct-workflow-gate-layer-design.md`
- `docs/architecture/as-built_execution_atlas.md`
- `docs/debriefs/2026-04-26-hitl-gate-story-reference.md`
- `workflows/post_to_reddit.yaml`
- `workflows/write_and_post_to_reddit.yaml`
- `src/workflow/engine.ts`
- `src/workflow/types.ts`
- `src/workflow/engine.test.ts`

## Outcome Required

At the end of this story:

- browser side-effect steps can declare postconditions
- Reddit submit must prove `/comments/` URL evidence
- draft steps must prove expected composer state
- postcondition pass/fail telemetry is emitted
- failed postconditions stop the workflow before false completion
- final HITL confirmation still remains the human-visible final verification layer
- typecheck and tests pass
