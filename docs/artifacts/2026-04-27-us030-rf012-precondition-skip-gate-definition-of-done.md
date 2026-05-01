# Generalized Precondition/Skip Gate — Definition Of Done

Story: `US-030`
Tracker Row: `RF-012`

The story is done only when all of the following are true:

1. Precondition gate exists:
   - helper is local to `src/workflow/engine.ts`
   - gate runs before `executeStep(...)`
   - gate runs before approval gating
   - gate returns run, skip, fail, and HITL decisions

2. Auth skip is lifted:
   - authenticated `human_takeover` with satisfied `authVerification` skips
   - unauthenticated `human_takeover` still publishes the HITL wait
   - skip happens before HITL wait publication

3. Generated-output skip is lifted:
   - valid existing `outputKey` skips writer invocation
   - invalid existing `outputKey` fails before skip
   - current content validation rules still apply

4. Navigation skip exists:
   - matching current URL skips `sessionManager.navigate(...)`
   - non-matching current URL runs navigation normally
   - skip result includes step id, step type, reason, and current URL

5. Existing safety gates remain intact:
   - approval gate still blocks protected side effects
   - content/output validation still blocks invalid generated content
   - Reddit duplicate evidence gate still blocks missing and risky evidence
   - browser postcondition gate still blocks false browser success
   - unresolved downstream placeholders still fail before browser side effects

6. Telemetry exists:
   - `workflow.precondition.evaluated`
   - `workflow.precondition.skipped`
   - `workflow.precondition.failed`
   - events include workflow id, session id, step id, step type, decision, reason, details, and current URL

7. Regression tests cover:
   - authenticated auth skip
   - unauthenticated auth wait
   - generate-content valid preflight skip
   - generate-content invalid preflight fail
   - navigate target-match skip
   - navigate target-miss run
   - skipped step result recording
   - skip telemetry
   - fail telemetry
   - approval gate still runs after precondition run
   - existing `US-027`, `US-028`, and `US-029` tests still pass
   - `mode: agentic` routing remains unchanged

8. Quality gates:
   - `pnpm run typecheck` exits `0`
   - `pnpm test` exits `0`

9. Forge evidence trail:
   - storyline artifact exists
   - YAML story card exists
   - implementation handoff exists
   - this definition-of-done artifact exists
   - `RF-012` row is updated to `Completed`
   - `US-030` has `passes: true`
   - `progress.txt` records a Summary of Work entry
   - `docs/history/forge_history.md` records the full story result
   - `docs/history/history_index.md` records one library-card row
   - `AGENTS.md` is not used for the long-form story entry
