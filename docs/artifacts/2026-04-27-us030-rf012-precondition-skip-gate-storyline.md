# Generalized Precondition/Skip Gate

Story: `US-030`
Tracker Row: `RF-012`
Date: `2026-04-27`

## Problem

The direct workflow engine now has approval, content validation, duplicate evidence, and browser postcondition gates. The remaining flexibility gap is pre-execution decision making.

Some skip behavior exists today, but it is scattered:

- authenticated login skip is inside `human_takeover`
- generated-content preflight skip is inside `generate_content`
- unresolved placeholder failure is split across side-effect handling
- navigation steps still run even when the browser is already on the target page
- skip decisions do not share one traceable gate contract

This keeps the direct engine more rigid than it needs to be and preserves part of the original reason `mode: agentic` was introduced.

## Why This Story Exists

`US-030` converts useful agentic flexibility into deterministic direct-path behavior.

The direct engine must decide when a step should run, skip, fail, pause for HITL, and leave a trace before side effects begin.

This story does not remove `mode: agentic`. It strengthens the direct kernel so later retirement work has evidence.

## Scope

This is an implementation story.

It must:

- add a direct-path precondition gate before `executeStep(...)`
- define a local precondition decision shape in `src/workflow/engine.ts`
- lift existing authenticated-login skip into the gate
- lift existing generate-content output-present skip into the gate
- add navigate URL-match skip
- keep unresolved placeholder failure before side effects
- emit structured precondition telemetry for run, skip, fail, and HITL decisions
- record skipped steps as successful traceable step results
- add regression tests
- preserve `mode: agentic`

It must not:

- remove the existing approval gate
- weaken content/output validation
- weaken Reddit duplicate evidence validation
- weaken browser postcondition validation
- implement the full `agent_task` side-effect safety boundary
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

- direct workflows have one precondition gate before `executeStep(...)`
- already-authenticated login waits can skip before HITL publication
- already-present generated outputs can skip writer invocation before content generation
- already-matching navigation targets can skip browser navigation
- unresolved downstream placeholders still fail before browser side effects
- every precondition decision emits traceable telemetry
- skipped steps are visible as successful skip results
- typecheck and tests pass
