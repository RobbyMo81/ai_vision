# Generalized Precondition/Skip Gate — Implementation Handoff

Story: `US-030`
Tracker Row: `RF-012`
Source Storyline: `docs/artifacts/2026-04-27-us030-rf012-precondition-skip-gate-storyline.md`
Source Story Card: `docs/artifacts/2026-04-27-us030-rf012-precondition-skip-gate-forge-story.yaml`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the storyline, YAML story card, definition of done, gate-layer design, atlas, and HITL gate quick reference before code changes.
2. Read `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, and `src/workflow/types.ts`.
3. Keep this story focused on pre-execution decisions before `executeStep(...)`.
4. Preserve `mode: agentic`.
5. Record the Summary of Work in `progress.txt`, then update PRD, tracker, and Forge history after validation passes.
6. Do not append long-form story history to `AGENTS.md`; append the story narrative to `docs/history/forge_history.md` and one library-card row to `docs/history/history_index.md`.

## Task

Implement the generalized precondition gate in the direct workflow run loop.

The implementation must:

1. Add one local precondition decision shape in `src/workflow/engine.ts`.
   - Name the helper `evaluatePreconditionGate`.
   - Return `decision`, `reason`, and `details`.
   - Supported decisions are `run`, `skip`, `fail`, and `hitl`.

2. Insert the gate before side effects.
   - Run it inside the direct step loop before approval gating.
   - Run it before `executeStep(...)`.
   - Keep approval gate ordering after a `run` decision.
   - Keep existing failure handling shape.

3. Lift authenticated-login skip into the gate.
   - Apply when `step.type === 'human_takeover'`.
   - Apply when the step has `authVerification`.
   - Use the existing deterministic `isAuthVerificationSatisfied(...)` logic.
   - Skip before HITL wait publication when authenticated signals are satisfied.
   - Continue to normal HITL flow when authenticated signals are not satisfied.

4. Lift generated-output skip into the gate.
   - Apply when `step.type === 'generate_content'`.
   - Apply when `outputs[step.outputKey]` already exists.
   - Validate existing output before skip using current output validation logic.
   - Skip writer invocation only when the existing output is valid.
   - Fail fast when the existing output is invalid.

5. Add navigation skip into the gate.
   - Apply when `step.type === 'navigate'`.
   - Compare current browser URL with the resolved target URL.
   - Skip `sessionManager.navigate(...)` when current URL already matches the target.
   - Run normally when the target is not matched.

6. Preserve unresolved-placeholder safety.
   - Keep downstream unresolved-placeholder checks before browser side effects.
   - If the current implementation remains outside the precondition helper, emit equivalent precondition failure telemetry before returning failure.
   - Do not let `agent_task`, `fill`, `type`, `click`, and `navigate` execute with unresolved `{{key}}` tokens.

7. Record skip results.
   - Skipped steps must appear as successful step results.
   - Include step id, step type, decision, reason, and details.
   - Preserve downstream output state.

8. Emit telemetry.
   - Emit `workflow.precondition.evaluated`.
   - Emit `workflow.precondition.skipped`.
   - Emit `workflow.precondition.failed`.
   - Include workflow id, session id, step id, step type, decision, reason, details, and current URL.

9. Preserve existing gates.
   - Approval gate from `US-026` must still run after precondition `run`.
   - Content validation from `US-027` must still run.
   - Duplicate evidence gate from `US-028` must still run.
   - Browser postcondition gate from `US-029` must still run.
   - Final HITL confirmation must remain unchanged.
   - Agentic routing must remain unchanged.

## Required Code Surfaces

1. [`src/workflow/engine.ts`](/home/spoq/ai-vision/src/workflow/engine.ts) — precondition helper and run-loop insertion
2. [`src/workflow/engine.test.ts`](/home/spoq/ai-vision/src/workflow/engine.test.ts) — regression tests
3. [`src/workflow/types.ts`](/home/spoq/ai-vision/src/workflow/types.ts) — only if type support is needed

## Required Tests

- authenticated `human_takeover` with satisfied `authVerification` skips before HITL publication.
- unauthenticated `human_takeover` with unsatisfied `authVerification` still publishes the HITL wait.
- `generate_content` skips writer invocation when valid output already exists.
- `generate_content` fails when preflight output exists but fails validation.
- `navigate` skips when current URL already matches the target URL.
- `navigate` runs when current URL does not match the target URL.
- skipped steps are recorded as successful step results.
- precondition skip telemetry is emitted.
- precondition fail telemetry is emitted.
- approval gate still blocks protected steps after a precondition `run`.
- existing `US-027`, `US-028`, and `US-029` tests still pass.
- `mode: agentic` routing remains unchanged.

## Acceptance Criteria

- Direct engine has one precondition gate before `executeStep(...)`.
- Authenticated login waits skip through the precondition gate.
- Generated-content output-present skip happens through the precondition gate.
- Navigation target match skip happens through the precondition gate.
- Invalid preflight output fails before writer skip.
- Unresolved downstream placeholders still fail before browser side effects.
- Skipped steps are traceable successful step results.
- Precondition telemetry is emitted for evaluated, skipped, and failed decisions.
- Final HITL confirmation remains present.
- `mode: agentic` remains present and untouched.
- `pnpm run typecheck` passes.
- `pnpm test` passes.

## Implementation Notes

- Keep the gate deterministic.
- Keep this story focused on pre-execution decisions.
- Do not implement the full `agent_task` side-effect safety boundary.
- Do not modify Python/browser-use internals.
- Do not replace final HITL confirmation.
- Do not remove `mode: agentic`.
