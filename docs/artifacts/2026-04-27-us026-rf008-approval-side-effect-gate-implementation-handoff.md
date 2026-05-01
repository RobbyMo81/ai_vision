# Approval Gate Before Browser Side Effects — Implementation Handoff

Story: `US-026`
Tracker Row: `RF-008`
Source Storyline: `docs/artifacts/2026-04-27-us026-rf008-approval-side-effect-gate-storyline.md`
Source Story Card: `docs/artifacts/2026-04-27-us026-rf008-approval-side-effect-gate-forge-story.yaml`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the storyline, YAML story card, definition of done, and HITL gate quick reference before code changes.
2. Read `src/workflow/engine.ts`, `src/workflow/types.ts`, `src/session/types.ts`, `src/ui/server.ts`, `src/workflow/engine.test.ts`, and `src/ui/server.test.ts`.
3. Keep this story focused on direct approval gating before protected step execution.
4. Preserve `mode: agentic`.
5. Use the existing `/api/return-control` resume path for approval waits.
6. Record the Summary of Work in `progress.txt`, then update PRD, tracker, and Forge history after validation passes.
7. Do not append long-form story history to `AGENTS.md`; append the story narrative to `docs/history/forge_history.md` and one library-card row to `docs/history/history_index.md`.

## Task

Implement direct approval gating before browser side effects in `ai-vision`.

The implementation must:

1. Add run-scoped approval state inside the direct `WorkflowEngine.run(...)` path.
   - Initialize it once per run.
   - Store approved step identity.
   - Store consumed approval status.
   - Never store approval globally.
   - Never store approval on a session-wide singleton.

2. Read approval requirements from `executionDefinition.permissions?.require_human_approval_before`.
   - Treat each entry as a protected step selector.
   - Support step id matches.
   - Support step type matches.
   - Keep matching deterministic.

3. Evaluate the approval gate in the direct run loop before `executeStep(...)`.
   - If the current step is not protected, continue to `executeStep(...)`.
   - If the current step is protected and already approved for this step, continue to `executeStep(...)`.
   - If the current step is protected and not approved, publish a HITL approval wait before execution.

4. Publish the approval wait through the canonical state publication helper.
   - `phase: 'hitl_qa'`
   - `hitlAction: 'approve_step'`
   - current step id
   - current step type
   - current step name
   - approval reason
   - current workflow/session identifiers

5. Resume the wait through the existing `hitlCoordinator.requestQaPause(...)` and `/api/return-control` path.
   - Extend the US-025 return-control action gate allowed pairs with `hitl_qa:approve_step`.
   - Keep the US-025 session binding gate.
   - Keep the US-025 WebSocket presence gate.
   - Keep `ui.hitl.return_control.received`, `.rejected`, and `.completed` telemetry.

6. After the approval wait resolves, record approval for the protected step before calling `executeStep(...)`.
   - Approved step id must match the step about to execute.
   - Approved step type must match the step about to execute.
   - Mismatch must fail fast.

7. After `executeStep(...)` returns, consume the approval.
   - Clear approved step id.
   - Clear approved step type.
   - Clear granted status.
   - Keep trace history in telemetry.

8. Emit structured approval gate telemetry.
   - `workflow.gate.approval.required`
   - `workflow.gate.approval.waiting`
   - `workflow.gate.approval.approved`
   - `workflow.gate.approval.consumed`
   - Include session id, workflow id, step id, step type, step name, gate decision, and approval selector.

## Required Code Surfaces

1. [`src/workflow/engine.ts`](/home/spoq/ai-vision/src/workflow/engine.ts) — direct run-loop approval gate
2. [`src/workflow/engine.test.ts`](/home/spoq/ai-vision/src/workflow/engine.test.ts) — direct engine regression tests
3. [`src/ui/server.ts`](/home/spoq/ai-vision/src/ui/server.ts) — return-control allowed wait-pair extension
4. [`src/ui/server.test.ts`](/home/spoq/ai-vision/src/ui/server.test.ts) — HITL resume regression tests
5. [`src/session/types.ts`](/home/spoq/ai-vision/src/session/types.ts) — verify `approve_step` remains in the HITL action union

## Required Tests

- protected direct step publishes `hitl_qa:approve_step` before execution
- protected side-effect step does not execute before approval
- active UI return-control approval resumes the protected step
- stale client approval returns HTTP `403`
- session mismatch approval returns HTTP `400`
- invalid phase/action approval returns HTTP `409`
- unprotected direct step executes without approval pause
- approval state is scoped to one run
- approval is consumed after the protected step returns
- `agent_task` cannot bypass approval when protected
- `mode: agentic` routing remains unchanged

## Acceptance Criteria

- Direct workflows enforce `permissions.require_human_approval_before`.
- Approval gate runs before `executeStep(...)`.
- Protected step publishes visible `hitl_qa:approve_step` state before blocking.
- `/api/return-control` accepts the active `hitl_qa:approve_step` wait through the existing bound endpoint.
- Stale clients, mismatched sessions, and invalid approval action states remain rejected by US-025 gates.
- Approved protected step executes only after approval is recorded.
- Approval state is run-scoped and consumed after step completion.
- Structured approval gate telemetry is emitted.
- `mode: agentic` remains present and untouched.
- `pnpm run typecheck` passes.
- `pnpm test` passes.

## Implementation Notes

- Keep the gate in the direct run loop before `executeStep(...)`.
- Keep browser side-effect blocking in TypeScript.
- Keep Python as a bounded worker that starts only after approval is present.
- Use the existing HITL return-control endpoint.
- Do not create a second approval endpoint.
- Do not add approval rejection semantics in this story.
- Do not implement content validation gates in this story.
- Do not implement browser postcondition gates in this story.
- Do not remove `mode: agentic`.
