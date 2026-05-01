# Agent Task Side-Effect Safety Gate — Implementation Handoff

Story: `US-031`
Tracker Row: `RF-013`
Source Storyline: `docs/artifacts/2026-04-28-us031-rf013-agent-task-side-effect-safety-storyline.md`
Source Story Card: `docs/artifacts/2026-04-28-us031-rf013-agent-task-side-effect-safety-forge-story.yaml`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the storyline, YAML story card, definition of done, gate-layer design, atlas, and HITL gate quick reference before code changes.
2. Read `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, and `src/workflow/types.ts`.
3. Keep this story focused on the `agent_task` side-effect boundary before worker dispatch.
4. Preserve `mode: agentic`.
5. Record the Summary of Work in `progress.txt`, then update PRD, tracker, and Forge history after validation passes.
6. Do not append long-form story history to `AGENTS.md`; append the story narrative to `docs/history/forge_history.md` and one library-card row to `docs/history/history_index.md`.

## Task

Implement an `agent_task` side-effect safety boundary in the direct workflow engine.

The implementation must:

1. Add one local classifier in `src/workflow/engine.ts`.
   - Name it `classifyAgentTaskSideEffect`.
   - Keep it deterministic.
   - Return `protectedIntent`, `intentKind`, `reason`, and `details`.
   - Classify submit, publish, post, final-click, login, fill, and external-mutation language as protected.
   - Classify browse, inspect, read, verify, check, and summarize language as read-only when no protected action is present.

2. Insert the safety check before worker dispatch.
   - Run it inside the `agent_task` branch before `routeAgentTask(...)`.
   - Run it after unresolved-placeholder checks.
   - Do not dispatch to Python/browser-use when a protected prompt fails safety checks.

3. Enforce approval evidence for protected actions.
   - If the workflow requires approval for the `agent_task` step, protected dispatch must only proceed after the direct approval gate has granted approval for that exact step.
   - If approval is missing for a protected required step, fail before worker dispatch.
   - Do not add a second approval endpoint.

4. Enforce content evidence for posting-style actions.
   - Posting-style `agent_task` prompts must not dispatch when required content outputs are missing.
   - Reuse existing output validation rules.
   - Fail before worker dispatch when content evidence is invalid.

5. Enforce Reddit duplicate evidence for Reddit submit-style actions.
   - Reddit submit-style `agent_task` prompts must require stored duplicate-check evidence from the same run.
   - Missing evidence must fail.
   - `DUPLICATE_RISK` evidence must fail.
   - Invalid score evidence must fail.

6. Preserve browser postcondition validation.
   - Existing `US-029` postcondition checks must still run after protected `agent_task` execution.
   - Do not skip postconditions because the safety gate allowed dispatch.

7. Emit telemetry.
   - Emit `workflow.agent_task_side_effect.evaluated`.
   - Emit `workflow.agent_task_side_effect.allowed`.
   - Emit `workflow.agent_task_side_effect.blocked`.
   - Include workflow id, session id, step id, intent kind, protected intent, decision, reason, and details.

8. Preserve existing gates.
   - Precondition gate from `US-030` must still run before approval.
   - Approval gate from `US-026` must still run before `executeStep`.
   - Content validation from `US-027` must still run.
   - Duplicate evidence gate from `US-028` must still run.
   - Browser postcondition gate from `US-029` must still run.
   - Final HITL confirmation must remain unchanged.
   - Agentic routing must remain unchanged.

## Required Code Surfaces

1. [`src/workflow/engine.ts`](/home/spoq/ai-vision/src/workflow/engine.ts) — classifier and `agent_task` safety boundary
2. [`src/workflow/engine.test.ts`](/home/spoq/ai-vision/src/workflow/engine.test.ts) — regression tests
3. [`src/workflow/types.ts`](/home/spoq/ai-vision/src/workflow/types.ts) — only if type support is needed

## Required Tests

- protected `agent_task` submit intent blocks before worker dispatch when approval evidence is missing.
- protected `agent_task` submit intent proceeds after approval evidence is recorded.
- posting-style `agent_task` fails before worker dispatch when required generated content is missing.
- posting-style `agent_task` fails before worker dispatch when required generated content is invalid.
- Reddit submit-style `agent_task` fails before worker dispatch when duplicate-check evidence is missing.
- Reddit submit-style `agent_task` fails before worker dispatch when duplicate risk is present.
- read-only `agent_task` still routes normally.
- protected `agent_task` still receives browser postcondition validation after execution.
- blocked telemetry is emitted.
- allowed telemetry is emitted.
- existing `US-026`, `US-027`, `US-028`, `US-029`, and `US-030` tests still pass.
- `mode: agentic` routing remains unchanged.

## Acceptance Criteria

- Direct engine classifies `agent_task` prompt side-effect intent before worker dispatch.
- Protected `agent_task` side effects cannot dispatch without required approval evidence.
- Posting-style `agent_task` side effects cannot dispatch without valid content evidence.
- Reddit submit-style `agent_task` side effects cannot dispatch without valid duplicate-check evidence.
- Read-only `agent_task` prompts still run normally.
- Browser postcondition validation still applies after protected `agent_task` execution.
- Side-effect safety telemetry is emitted for evaluated, allowed, and blocked decisions.
- Final HITL confirmation remains present.
- `mode: agentic` remains present and untouched.
- `pnpm run typecheck` passes.
- `pnpm test` passes.

## Implementation Notes

- Keep the classifier deterministic and conservative.
- Keep this story focused on `agent_task` dispatch safety.
- Do not modify Python/browser-use internals.
- Do not add a second approval endpoint.
- Do not replace final HITL confirmation.
- Do not remove `mode: agentic`.
