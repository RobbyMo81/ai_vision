# Content/Output Validation Gate — Definition Of Done

Story: `US-027`
Tracker Row: `RF-009`

The story is done only when all of the following are true:

1. Direct output validation exists in `src/workflow/engine.ts`:
   - generated body output is validated
   - generated title output is validated when `outputTitleKey` is configured
   - preflight-provided output is validated before generation skip
   - downstream unresolved placeholders are detected before side-effect execution

2. Invalid generated values fail fast:
   - empty string
   - whitespace-only string
   - unresolved `{{...}}`
   - `TODO`
   - `TBD`
   - `Lorem ipsum`
   - bracketed generated placeholder text
   - missing required title

3. Side-effect protection is preserved:
   - invalid content does not reach `agent_task`
   - invalid content does not reach `fill`
   - invalid content does not reach `type`
   - invalid content does not reach `click`
   - invalid content does not reach `navigate`

4. Telemetry exists:
   - `workflow.output_validation.passed`
   - `workflow.output_validation.failed`
   - events include workflow id, session id, step id, step type, output key, reason, and detail fields

5. Regression tests cover:
   - empty generated body
   - whitespace generated body
   - unresolved placeholder generated body
   - `TODO` generated body
   - missing required generated title
   - invalid required generated title
   - invalid preflight output before generation skip
   - unresolved placeholder in downstream `agent_task`
   - unresolved placeholder in downstream `fill`
   - valid `ai-vision` body and title
   - RF-001 same-run substitution still passes
   - `mode: agentic` routing remains unchanged

6. Quality gates:
   - `pnpm run typecheck` exits `0`
   - `pnpm test` exits `0`

7. Forge evidence trail:
   - storyline artifact exists
   - YAML story card exists
   - implementation handoff exists
   - this definition-of-done artifact exists
   - `RF-009` row is updated to `Completed`
   - `US-027` has `passes: true`
   - `progress.txt` records a Summary of Work entry
   - `docs/history/forge_history.md` records the full story result
   - `docs/history/history_index.md` records one library-card row
   - `AGENTS.md` is not used for the long-form story entry
