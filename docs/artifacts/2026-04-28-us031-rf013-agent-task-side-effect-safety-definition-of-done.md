# Agent Task Side-Effect Safety Gate — Definition Of Done

Story: `US-031`
Tracker Row: `RF-013`

The story is done only when all of the following are true:

1. Side-effect classifier exists:
   - helper is local to `src/workflow/engine.ts`
   - classifier runs inside `agent_task`
   - classifier runs before `routeAgentTask(...)`
   - classifier is deterministic
   - classifier distinguishes protected and read-only intent

2. Protected dispatch is gated:
   - submit, publish, post, final-click, login, fill, and external-mutation intent are protected
   - protected `agent_task` does not dispatch when required safety evidence is missing
   - read-only `agent_task` still dispatches normally

3. Approval safety is enforced:
   - protected `agent_task` requiring approval dispatches only after approval is granted for the same step
   - missing approval fails before worker dispatch
   - existing approval endpoint and return-control path remain unchanged

4. Content safety is enforced:
   - posting-style `agent_task` requires valid generated content evidence
   - missing content fails before worker dispatch
   - invalid content fails before worker dispatch
   - existing output validation rules remain authoritative

5. Reddit duplicate safety is enforced:
   - Reddit submit-style `agent_task` requires same-run duplicate-check evidence
   - missing evidence fails before worker dispatch
   - duplicate-risk evidence fails before worker dispatch
   - invalid score evidence fails before worker dispatch

6. Existing gates remain intact:
   - precondition gate still runs first
   - approval gate still runs before side effects
   - content validation still blocks invalid output
   - duplicate evidence gate still blocks explicit submit steps
   - browser postcondition gate still validates after protected `agent_task`
   - final HITL confirmation remains unchanged

7. Telemetry exists:
   - `workflow.agent_task_side_effect.evaluated`
   - `workflow.agent_task_side_effect.allowed`
   - `workflow.agent_task_side_effect.blocked`
   - events include workflow id, session id, step id, intent kind, protected intent, decision, reason, and details

8. Regression tests cover:
   - protected submit intent blocked without approval
   - protected submit intent allowed after approval
   - posting-style task blocked without content
   - posting-style task blocked with invalid content
   - Reddit submit-style task blocked without duplicate evidence
   - Reddit submit-style task blocked on duplicate risk
   - read-only task allowed
   - protected task still receives postcondition validation
   - blocked telemetry
   - allowed telemetry
   - existing `US-026` through `US-030` tests still pass
   - `mode: agentic` routing remains unchanged

9. Quality gates:
   - `pnpm run typecheck` exits `0`
   - `pnpm test` exits `0`

10. Forge evidence trail:
   - storyline artifact exists
   - YAML story card exists
   - implementation handoff exists
   - this definition-of-done artifact exists
   - `RF-013` row is updated to `Completed`
   - `US-031` has `passes: true`
   - `progress.txt` records a Summary of Work entry
   - `docs/history/forge_history.md` records the full story result
   - `docs/history/history_index.md` records one library-card row
   - `AGENTS.md` is not used for the long-form story entry
