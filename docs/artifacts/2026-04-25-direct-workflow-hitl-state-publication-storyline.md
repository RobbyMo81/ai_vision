# Direct Workflow HITL State Publication Storyline

Story: `US-023`  
Tracker Row: `RF-005`  
Date: `2026-04-25`

## Problem

`US-022` defined the direct workflow gate layer contract, but the first implementation seam is still open:

- direct workflow waits and terminal transitions publish through multiple partially coupled surfaces
- `hitlCoordinator` owns the blocking wait
- `workflowEngine.currentState` is the public runtime projection
- [`/api/status`](/home/spoq/ai-vision/src/ui/server.ts) and websocket pushes derive from that projection

Today those surfaces can drift during `awaiting_human`, `pii_wait`, `hitl_qa`, final confirmation, and terminal completion/error transitions.

That is the first production gap to close because every later gate depends on one visible, trustworthy public state path.

## Why This Story Exists

The direct engine cannot become the semantically authoritative workflow kernel until all human waits and terminal states are published canonically.

This story exists to implement Phase 1 of the direct gate layer:

- canonical HITL state publication
- one explicit state transition wrapper in the direct engine
- one visible operator-facing action state for every wait
- no hidden divergence between engine phase, HITL wait, `/api/status`, and websocket/UI projection

## Scope

This story is implementation, but narrow implementation.

It must:

- implement the direct-path state publication wrapper described by `US-022`
- route every direct HITL wait through that wrapper before blocking
- route terminal `complete` and `error` through that wrapper before shutdown
- preserve `hitlCoordinator` as the wait owner
- preserve `mode: agentic`
- add regression tests that prove every visible wait/action state is published

It must not:

- implement approval enforcement yet
- implement full side-effect blocking yet
- implement the full precondition/skip gate system yet
- remove `mode: agentic`
- widen into a general workflow rewrite

## Source Evidence

- [2026-04-24-direct-workflow-gate-layer-design.md](/home/spoq/ai-vision/docs/artifacts/2026-04-24-direct-workflow-gate-layer-design.md)
- [as-built_execution_atlas.md](/home/spoq/ai-vision/docs/architecture/as-built_execution_atlas.md)
- [engine.ts](/home/spoq/ai-vision/src/workflow/engine.ts)
- [hitl.ts](/home/spoq/ai-vision/src/session/hitl.ts)
- [server.ts](/home/spoq/ai-vision/src/ui/server.ts)
- [types.ts](/home/spoq/ai-vision/src/session/types.ts)

## Outcome Required

At the end of this story:

- the direct engine has one canonical state-publication path for wait and terminal transitions
- every direct HITL wait exposes the correct visible `phase` and `hitlAction`
- `/api/status` and websocket/UI projection reflect the same workflow state the engine published
- tests prove the direct engine no longer hides or drops the human-action state required for later approval and side-effect gates
