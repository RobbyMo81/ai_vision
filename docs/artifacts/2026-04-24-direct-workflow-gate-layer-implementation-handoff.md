# Direct Workflow Gate Layer Design Implementation Handoff

Story: `US-022`  
Tracker Row: `RF-004`  
Source Story Card: `docs/artifacts/2026-04-24-direct-workflow-gate-layer-forge-story.yaml`  
Source Storyline: `docs/artifacts/2026-04-24-direct-workflow-gate-layer-storyline.md`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the atlas, agentic discovery, storyline, and YAML story card before writing anything.
2. Treat this as a design story, not an implementation story.
3. Produce the smallest coherent gate-layer design package that makes the direct workflow kernel explicit and authoritative.
4. Do not delete `mode: agentic`, do not move to Rust, and do not remove Python as the bounded worker layer.
5. Write back tracker, progress, and Forge context for the next agent.

## Task

Design the direct workflow gate layer for `ai-vision`.

The design must answer:

- what `GateDecision` is
- what `GateContext` is
- where gates run in [`src/workflow/engine.ts`](/home/spoq/ai-vision/src/workflow/engine.ts)
- how HITL state is published canonically
- how approval state is represented and checked
- how Python/browser-use is blocked before side effects
- how `run | skip | fail | hitl | retry` decisions are traced
- what tests are required before `mode: agentic` can be retired

## Required Outputs

The story is not complete until all of the following exist:

1. A design artifact that defines the direct gate contracts and insertion points.
2. A state ownership section that resolves the relationship between `hitlCoordinator`, `workflowEngine.currentState`, `/api/status`, and websocket state.
3. An approval and side-effect policy section that blocks Python/browser-use before irreversible mutations.
4. A minimum test matrix for the direct-path gate layer.
5. Tracker and progress evidence for handoff continuity.

## Acceptance Criteria

- The design keeps TypeScript as the workflow kernel.
- The design keeps Python as the bounded intelligence/browser-worker layer.
- Rust is explicitly out of scope for this story.
- `mode: agentic` is not removed in this story.
- The design identifies deterministic direct-path replacements for the useful flexibility previously provided by the agentic outer planner.
- The design is specific enough that a later implementation story can execute without re-running architecture discovery.

## Definition of Done

Done means the repo contains a governed design package for the direct workflow gate layer that:

- defines the gate contracts
- identifies where each gate runs
- defines the canonical state model for HITL publication
- defines the approval and side-effect blocking model
- names the minimum required tests before retiring `mode: agentic`
- leaves runtime code unchanged

## Implementation Notes

- Keep the design grounded in the current engine, not a hypothetical rewrite.
- Prefer explicit interfaces, state-owner tables, and insertion maps over broad narrative prose.
- Treat the Claude orchestrator as a quarantined outer planner, not as the future kernel.
- If the design discovers a blocker, record the blocker narrowly instead of widening scope into implementation.
