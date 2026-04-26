# Direct Workflow Gate Layer Design Definition Of Done

Story: `US-022`  
Tracker Row: `RF-004`

The story is done only when all of the following are true:

1. The repo contains a design artifact that explicitly defines:
   - `GateDecision`
   - `GateContext`
   - gate trace semantics
   - approval state representation
   - HITL state publication ownership

2. The design maps the exact gate insertion points in the direct engine for:
   - before step execution
   - inside step-specific branches
   - after step execution
   - before browser side effects
   - after browser side effects
   - before HITL wait
   - after HITL resume
   - before story/SIC write

3. The design defines how direct-path gates can make these decisions:
   - `run`
   - `skip`
   - `fail`
   - `hitl`
   - `retry`

4. The design explicitly preserves the current strategic architecture:
   - `TypeScript` remains the workflow kernel
   - `Python` remains the bounded intelligence/browser-worker layer
   - `Rust` remains out of scope
   - `mode: agentic` remains present until the direct-path replacement is proven

5. The design defines the minimum test matrix required before `mode: agentic` can be retired, including:
   - HITL publication visibility
   - approval enforcement
   - precondition/skip behavior
   - content/output validation
   - browser side-effect blocking
   - bounded `agent_task` safety

6. The story remains design-only:
   - no gate layer implementation
   - no runtime behavior changes
   - no deletion of `mode: agentic`

7. The Forge evidence trail is complete:
   - storyline artifact exists
   - YAML story card exists
   - implementation handoff exists
   - definition-of-done artifact exists
   - tracker and progress entries are updated
