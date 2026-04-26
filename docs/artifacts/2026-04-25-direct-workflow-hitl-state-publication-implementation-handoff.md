# Direct Workflow HITL State Publication Implementation Handoff

Story: `US-023`  
Tracker Row: `RF-005`  
Source Story Card: `docs/artifacts/2026-04-25-direct-workflow-hitl-state-publication-forge-story.yaml`  
Source Storyline: `docs/artifacts/2026-04-25-direct-workflow-hitl-state-publication-storyline.md`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the `US-022` design artifact, atlas, storyline, and YAML story card before writing code.
2. Treat this as the first narrow implementation story of the direct gate layer, not a general workflow rewrite.
3. Implement only the canonical HITL/public-state publication slice needed to make later gates trustworthy.
4. Do not remove `mode: agentic`.
5. Do not implement approval, side-effect, or skip gates beyond the state-publication seam required by this story.
6. Write back tracker, progress, Forge memory, and tests for the next agent.

## Task

Implement Phase 1 of the direct workflow gate layer in `ai-vision`.

The implementation must answer:

- where the canonical direct-engine state transition helper lives
- how each direct HITL wait publishes `phase` plus `hitlAction` before blocking
- how `workflowEngine.currentState`, `hitlCoordinator`, `/api/status`, and websocket projection stay aligned
- how terminal `complete` and `error` still reach the operator before shutdown

## Required Code Surfaces

The story will likely touch:

1. [`src/workflow/engine.ts`](/home/spoq/ai-vision/src/workflow/engine.ts)
2. [`src/session/hitl.ts`](/home/spoq/ai-vision/src/session/hitl.ts)
3. [`src/session/types.ts`](/home/spoq/ai-vision/src/session/types.ts)
4. [`src/ui/server.ts`](/home/spoq/ai-vision/src/ui/server.ts)
5. direct-engine tests in the corresponding `*.test.ts` files

## Acceptance Criteria

- A canonical engine state publication helper exists and is used by the direct workflow path.
- Every direct HITL wait publishes a visible operator action state before the blocking wait begins.
- `workflowEngine.currentState` remains the canonical public workflow projection.
- `hitlCoordinator` remains the blocking wait owner rather than being replaced by a second state machine.
- `/api/status` and websocket projection reflect the converged state for all direct waits and terminal transitions.
- Tests cover `awaiting_human`, `pii_wait`, `hitl_qa`, final confirmation, and terminal `complete` / `error` visibility.
- `mode: agentic` remains present and untouched.

## Definition of Done

Done means the direct engine has a working Phase 1 gate-layer implementation that:

- publishes wait and terminal states through one canonical path
- keeps the operator-visible state surfaces aligned
- preserves the existing direct engine and HITL ownership model
- adds regression tests for the visible wait-state matrix
- leaves approval, side-effect, and skip-gate implementation for later stories

## Implementation Notes

- Ground the implementation in the current engine shape from `US-022`; do not invent a new orchestration model.
- The wrapper should centralize publication, not duplicate wrap-up or HITL blocking logic.
- If you discover missing wait-state data needed by the UI, add the smallest explicit state fields required by the design.
- Keep the implementation small enough that later approval and side-effect gates can compose on top of it instead of refactoring it immediately.
