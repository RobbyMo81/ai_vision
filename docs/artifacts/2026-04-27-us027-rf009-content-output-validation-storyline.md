# Content/Output Validation Gate

Story: `US-027`
Tracker Row: `RF-009`
Date: `2026-04-27`

## Problem

The direct workflow engine can generate content, write runtime outputs, and substitute those outputs into later browser steps. It still lacks a generic validation gate that proves generated and substituted content is safe enough to enter the browser side-effect path.

The gate-layer design identifies this gap as `output-validation`:

- generated output can be empty
- generated output can contain placeholder text
- generated output can omit a required title
- generated output can be generic and unrelated to `ai-vision`
- downstream step prompts can still contain unresolved placeholders before browser execution

Without this story, the direct path can carry weak content into Reddit/X/browser-use posting steps even though HITL approval and endpoint binding are now stronger.

## Why This Story Exists

`US-026` proved the engine can block protected side effects until approval exists. That does not prove the approved content is valid.

`US-027` adds the first data-integrity gate in the approved sequence:

1. validate generated outputs immediately after `generate_content`
2. validate preflight-provided outputs before skipping generation
3. reject unresolved placeholder content before downstream browser execution
4. emit structured validation telemetry
5. fail fast before browser-use can post weak content

## Scope

This is an implementation story.

It must:

- add a direct-path output validation helper in `src/workflow/engine.ts`
- validate `generate_content.outputKey`
- validate `generate_content.outputTitleKey` when present
- validate preflight output values before `generate_content` is skipped
- reject empty and whitespace-only output
- reject unresolved template markers such as `{{value}}`
- reject known placeholder/generic markers such as `TODO`, `TBD`, `Lorem ipsum`, and bracketed generated placeholders
- reject missing title when `outputTitleKey` is configured
- reject downstream steps that still contain unresolved placeholders before browser side effects
- emit validation telemetry for pass and fail decisions
- add regression tests in `src/workflow/engine.test.ts`
- preserve `mode: agentic`

It must not:

- implement Reddit duplicate-title evidence scoring
- implement browser side-effect postconditions
- implement generalized skip gates
- implement the `agent_task` safety boundary
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

- invalid generated content fails before downstream browser steps
- missing generated title fails before downstream browser steps
- placeholder/generic generated content fails fast
- unresolved downstream placeholders fail before browser-use execution
- valid `ai-vision` content passes
- telemetry records validation decisions
- typecheck and test gates pass
