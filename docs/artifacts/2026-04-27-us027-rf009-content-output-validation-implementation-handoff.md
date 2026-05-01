# Content/Output Validation Gate — Implementation Handoff

Story: `US-027`
Tracker Row: `RF-009`
Source Storyline: `docs/artifacts/2026-04-27-us027-rf009-content-output-validation-storyline.md`
Source Story Card: `docs/artifacts/2026-04-27-us027-rf009-content-output-validation-forge-story.yaml`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the storyline, YAML story card, definition of done, gate-layer design, atlas, and HITL gate quick reference before code changes.
2. Read `src/workflow/engine.ts`, `src/workflow/types.ts`, and `src/workflow/engine.test.ts`.
3. Keep this story focused on content/output validation in the direct workflow path.
4. Preserve `mode: agentic`.
5. Record the Summary of Work in `progress.txt`, then update PRD, tracker, and Forge history after validation passes.
6. Do not append long-form story history to `AGENTS.md`; append the story narrative to `docs/history/forge_history.md` and one library-card row to `docs/history/history_index.md`.

## Task

Implement direct content/output validation before browser side effects.

The implementation must:

1. Add one validation helper in `src/workflow/engine.ts`.
   - Name it `validateWorkflowOutput`.
   - Keep it local to `engine.ts`.
   - Return a small result object with `valid`, `reason`, and `details`.
   - Accept output key, value, step id, step type, workflow id, and session id.

2. Add one downstream placeholder helper in `src/workflow/engine.ts`.
   - Name it `findUnresolvedPlaceholders`.
   - Inspect resolved step string values.
   - Return placeholder names still wrapped in `{{...}}`.
   - Keep the scan deterministic and shallow enough for workflow step objects.

3. Validate `generate_content` body output.
   - Run validation immediately after `outputs[sub.outputKey] = generated.text`.
   - Fail the step when validation fails.
   - Do not proceed to later workflow steps after failure.

4. Validate `generate_content` title output when `outputTitleKey` is configured.
   - Fail when the generated title is missing.
   - Fail when the generated title is invalid.

5. Validate preflight-provided output before skipping `generate_content`.
   - The current skip branch checks existing `outputs[sub.outputKey]`.
   - Add validation before emitting the skip result.
   - Fail instead of skipping when preflight output is invalid.

6. Reject these invalid values:
   - empty string
   - whitespace-only string
   - string containing unresolved `{{...}}`
   - string containing `TODO`
   - string containing `TBD`
   - string containing `Lorem ipsum`
   - string beginning with `[Generated`
   - string beginning with `<`

7. Add downstream unresolved-placeholder validation before side-effect execution.
   - Run after `const step = substituteStep(stepTemplate, runtimeParams)`.
   - Run before the approval gate and before `executeStep(...)`.
   - Apply to steps that can reach browser side effects: `agent_task`, `fill`, `type`, `click`, and `navigate`.
   - Fail fast when unresolved placeholders remain.

8. Emit structured telemetry.
   - Emit `workflow.output_validation.passed` for valid generated body and title outputs.
   - Emit `workflow.output_validation.failed` for invalid generated body, invalid title, invalid preflight output, and unresolved downstream placeholders.
   - Include workflow id, session id, step id, step type, output key, reason, and detail fields.

9. Preserve existing successful behavior.
   - RF-001 runtime substitution tests must still pass.
   - US-026 approval-gate tests must still pass.
   - Agentic YAML routing must remain unchanged.

## Required Code Surfaces

1. [`src/workflow/engine.ts`](/home/spoq/ai-vision/src/workflow/engine.ts) — validation helpers and gate calls
2. [`src/workflow/engine.test.ts`](/home/spoq/ai-vision/src/workflow/engine.test.ts) — regression tests

## Required Tests

- `generate_content` empty body fails fast.
- `generate_content` whitespace body fails fast.
- `generate_content` unresolved placeholder body fails fast.
- `generate_content` `TODO` body fails fast.
- `generate_content` missing required title fails fast.
- `generate_content` invalid required title fails fast.
- preflight-provided invalid output fails before skip.
- downstream unresolved placeholder in `agent_task` fails before `registry.getReady`.
- downstream unresolved placeholder in `fill` fails before browser interaction.
- valid `ai-vision` body and title pass validation.
- RF-001 same-run substitution still passes.
- `mode: agentic` routing remains unchanged.

## Acceptance Criteria

- Direct workflows validate generated content before downstream browser steps.
- Direct workflows validate preflight content before generation skip.
- Missing required generated title fails fast.
- Placeholder and generic generated values fail fast.
- Unresolved downstream placeholders fail before browser side effects.
- Validation telemetry is emitted for pass and fail decisions.
- `mode: agentic` remains present and untouched.
- `pnpm run typecheck` passes.
- `pnpm test` passes.

## Implementation Notes

- Keep validation deterministic.
- Keep the validator local to the workflow engine.
- Use existing `WorkflowStepResult` failure shape.
- Keep failure messages specific enough for SIC capture.
- Do not add Reddit duplicate evidence scoring in this story.
- Do not add browser postcondition checks in this story.
- Do not add generalized skip gates in this story.
- Do not add `agent_task` side-effect policy in this story.
- Do not remove `mode: agentic`.
