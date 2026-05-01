# Approval Gate Before Browser Side Effects — Definition Of Done

Story: `US-026`
Tracker Row: `RF-008`

The story is done only when all of the following are true:

1. Direct workflow approval state exists and is run-scoped:
   - initialized once inside `WorkflowEngine.run(...)`
   - not global
   - not session-wide
   - consumed after the protected step returns

2. The direct engine honors `permissions.require_human_approval_before`:
   - step id selectors are supported
   - step type selectors are supported
   - deterministic matching is tested
   - unprotected steps run without approval pause

3. The approval gate runs before `executeStep(...)`:
   - protected steps do not reach `executeStep(...)` before approval
   - protected `agent_task` steps cannot bypass the gate
   - protected browser side-effect steps cannot call Python/browser-use before approval

4. The approval wait publishes visible operator state before blocking:
   - `phase: hitl_qa`
   - `hitlAction: approve_step`
   - current step id
   - current step type
   - current step name
   - approval reason

5. The approval wait resumes through the existing return-control endpoint:
   - `/api/return-control` allows `hitl_qa:approve_step`
   - US-025 session binding remains active
   - US-025 WebSocket presence binding remains active
   - US-025 invalid phase/action rejection remains active

6. Approval telemetry exists:
   - `workflow.gate.approval.required`
   - `workflow.gate.approval.waiting`
   - `workflow.gate.approval.approved`
   - `workflow.gate.approval.consumed`
   - every event includes session id, workflow id, step id, step type, step name, gate decision, and approval selector

7. Regression tests cover:
   - protected step publishes `hitl_qa:approve_step`
   - protected step does not execute before approval
   - active UI approval resumes execution
   - stale client approval returns HTTP `403`
   - session mismatch approval returns HTTP `400`
   - invalid phase/action approval returns HTTP `409`
   - unprotected step bypasses approval pause
   - approval state does not leak across runs
   - approval is consumed after protected step completion
   - protected `agent_task` cannot bypass the gate
   - `mode: agentic` still routes to the orchestrator loop

8. Quality gates:
   - `pnpm run typecheck` exits `0`
   - `pnpm test` exits `0`

9. Forge evidence trail:
   - storyline artifact exists
   - YAML story card exists
   - implementation handoff exists
   - this definition-of-done artifact exists
   - `RF-008` row is updated to `Completed`
   - `US-026` has `passes: true`
   - `progress.txt` records a Summary of Work entry
   - `docs/history/forge_history.md` records the full story result
   - `docs/history/history_index.md` records one library-card row
   - `AGENTS.md` is not used for the long-form story entry
