# Approval Gate Before Browser Side Effects

Story: `US-026`
Tracker Row: `RF-008`
Date: `2026-04-27`

## Problem

The direct workflow engine now has canonical HITL state publication (`US-023`) and bound resume endpoints for final confirmation plus return-control (`US-024`, `US-025`). The next production gap is approval enforcement before browser side effects.

The direct engine already accepts workflow permissions through `permissions.require_human_approval_before`, but the direct run loop does not yet enforce that permission as a generic gate before `executeStep(...)`. The as-built atlas and gate-layer design both identify this as agentic-only behavior that must move into the direct path.

Without this story, a direct workflow can reach a browser mutation step before the operator has approved that step in a visible, bound HITL state.

## Why This Story Exists

`mode: agentic` was originally added to bypass rigid direct workflows. The safer replacement is not another hidden planner. The safer replacement is explicit direct-path gates.

This story implements the next direct-path gate:

- read workflow approval requirements from `permissions.require_human_approval_before`
- pause before configured side-effect steps
- publish `hitl_qa` with `hitlAction: approve_step`
- resume only through the already bound return-control endpoint
- record run-scoped approval before executing the protected step

## Scope

This is an implementation story.

It must:

- initialize run-scoped approval state inside the direct `WorkflowEngine.run(...)` path
- evaluate approval before each protected direct step reaches `executeStep(...)`
- use `permissions.require_human_approval_before` as the source of protected step identifiers and step types
- publish visible HITL approval state before blocking:
  - `phase: hitl_qa`
  - `hitlAction: approve_step`
  - current step metadata
  - approval reason
- wait through the existing HITL return-control path
- extend the `POST /api/return-control` action gate to allow `hitl_qa:approve_step`
- mark the protected step as approved in the run-scoped approval ledger before `executeStep(...)`
- clear the consumed approval after the protected step completes
- emit structured approval-gate telemetry
- prove a protected browser side-effect step cannot execute before approval
- preserve `mode: agentic`

It must not:

- remove `mode: agentic`
- add a new approval endpoint
- add rejection semantics for approval waits
- implement content/output validation gates
- implement browser postcondition gates
- change Python/browser-use behavior except by preventing calls until approval exists
- weaken the US-024 and US-025 session/client binding gates

## Source Evidence

- `docs/architecture/as-built_execution_atlas.md`
- `docs/artifacts/2026-04-24-direct-workflow-gate-layer-design.md`
- `docs/debriefs/2026-04-26-hitl-gate-story-reference.md`
- `src/workflow/engine.ts`
- `src/workflow/types.ts`
- `src/session/types.ts`
- `src/ui/server.ts`
- `src/ui/server.test.ts`

## Outcome Required

At the end of this story:

- direct workflows enforce `permissions.require_human_approval_before`
- a protected side-effect step pauses in visible `hitl_qa:approve_step` before execution
- stale tabs and mismatched sessions remain blocked by the existing return-control gates
- the active UI tab can approve and resume the protected step through `/api/return-control`
- the protected step cannot execute before approval is recorded
- approval state is scoped to one workflow run
- typecheck and test gates pass
