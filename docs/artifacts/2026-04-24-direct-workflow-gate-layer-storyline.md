# Direct Workflow Gate Layer Storyline

Story: `US-022`  
Tracker Row: `RF-004`  
Date: `2026-04-24`

## Problem

`ai-vision` already has the right language split:

- `TypeScript` = workflow kernel, runtime coordinator, UI, state projection
- `Python` = bounded browser automation and model-facing worker layer
- `YAML` = workflow declaration
- `HITL/HACC` = human decision plane
- `Story/SIC` = learning sink

The architectural weakness is not the language split. The weakness is that the workflow kernel is only partially coherent because `mode: agentic` introduces a second execution semantics beside the direct engine.

The direct engine in [`src/workflow/engine.ts`](/home/spoq/ai-vision/src/workflow/engine.ts) is the real production kernel. The outer Claude planner in [`src/orchestrator/loop.ts`](/home/spoq/ai-vision/src/orchestrator/loop.ts) provides useful flexibility, but it does so by creating a hidden planning layer with weaker guarantees around state ownership, approval enforcement, content validation, and browser side-effect control.

## Why This Story Exists

The next move is not:

- remove Python
- rewrite the system in Rust
- delete `mode: agentic` immediately

The next move is:

- design the direct workflow gate layer so the direct TypeScript engine becomes semantically authoritative

That gate layer must give the direct engine explicit, deterministic control over:

- skip logic
- preconditions
- approval enforcement
- HITL publication
- side-effect blocking
- output validation
- failure classification
- story/SIC pre-write decisions

## Scope

This story is design-only.

It must define:

- `GateDecision`
- `GateContext`
- where gates execute inside the direct workflow engine
- how gate outcomes are traced
- how HITL state is published canonically
- how approval is represented and enforced
- how Python/browser-use is blocked before side effects
- the minimum test matrix required before `mode: agentic` can be retired

It must not:

- implement the gate layer
- delete `mode: agentic`
- replace Python
- propose a Rust migration

## Source Evidence

- [as-built_execution_atlas.md](/home/spoq/ai-vision/docs/architecture/as-built_execution_atlas.md)
- [Discovery_mode-agentic.md](/home/spoq/ai-vision/docs/debriefs/Discovery_mode-agentic.md)
- [engine.ts](/home/spoq/ai-vision/src/workflow/engine.ts)
- [hitl.ts](/home/spoq/ai-vision/src/session/hitl.ts)
- [server.ts](/home/spoq/ai-vision/src/ui/server.ts)
- [loop.ts](/home/spoq/ai-vision/src/orchestrator/loop.ts)

## Outcome Required

At the end of this story, the repo should contain a design package that a later implementation story can execute directly, without re-litigating:

- who owns workflow state
- where gates run
- how bounded intelligence is called
- how side effects are blocked
- how approval and HITL waits become visible
- what tests must pass before `mode: agentic` can be quarantined
