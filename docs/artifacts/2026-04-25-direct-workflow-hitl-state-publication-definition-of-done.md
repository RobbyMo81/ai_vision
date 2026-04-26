# Direct Workflow HITL State Publication Definition Of Done

Story: `US-023`  
Tracker Row: `RF-005`

The story is done only when all of the following are true:

1. The direct workflow engine has one canonical public state publication path for:
   - running transitions
   - direct HITL waits
   - terminal `complete`
   - terminal `error`

2. Every direct HITL wait publishes the correct visible operator state before blocking, including:
   - `awaiting_human`
   - `pii_wait`
   - `hitl_qa`
   - final confirmation / completion verification

3. The state ownership contract remains explicit:
   - `workflowEngine.currentState` is the canonical public projection
   - `hitlCoordinator` remains the blocking wait owner
   - `/api/status` and websocket/UI state are projections of the engine-published state

4. The implementation does not widen beyond Phase 1:
   - no approval gate implementation
   - no full side-effect gate implementation
   - no broad skip-gate implementation
   - no removal of `mode: agentic`

5. Regression tests prove that:
   - every direct wait exposes the correct `phase` and `hitlAction`
   - terminal `complete` reaches the UI-visible state path
   - terminal `error` reaches the UI-visible state path
   - the direct engine does not silently enter a human wait without publishing the visible action state first

6. The Forge evidence trail is complete:
   - storyline artifact exists
   - YAML story card exists
   - implementation handoff exists
   - definition-of-done artifact exists
   - tracker and PRD are updated
   - progress and Forge memory continuity are updated
