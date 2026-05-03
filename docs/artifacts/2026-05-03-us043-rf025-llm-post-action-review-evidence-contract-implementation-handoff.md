# US-043 / RF-025 Implementation Handoff

## Agent Prompt

You are the build agent for `US-043 / RF-025: LLM Post-Action Review Evidence Contract`.

Use the Forge system and the Forge build loop explicitly. Before editing code, read:

1. `FORGE.md`
2. `AGENTS.md`
3. `prd.json`
4. `progress.txt`
5. `docs/artifacts/2026-05-03-us043-rf025-llm-post-action-review-evidence-contract-storyline.md`
6. `docs/artifacts/2026-05-03-us043-rf025-llm-post-action-review-evidence-contract-forge-story.yaml`
7. `docs/artifacts/2026-05-03-us043-rf025-llm-post-action-review-evidence-contract-definition-of-done.md`
8. `src/workflow/engine.ts`
9. `src/workflow/engine.test.ts`
10. `src/ui/server.ts`
11. `src/ui/server.test.ts`

## Build Intent

The system must take advantage of the LLM model's reasoning ability after browser side effects, without letting the LLM bypass deterministic safety gates.

Implement a structured post-action review evidence contract for side-effecting `agent_task` steps. Use that evidence as corroborating input to deterministic postconditions. When the LLM says success and the deterministic gate says failure, escalate the disagreement to HITL review instead of producing an immediate false terminal failure.

## Required Implementation Shape

1. Add a typed post-action review evidence contract.
2. Parse browser-use final output into that contract when fields are present or inferable.
3. Keep raw LLM output available for traceability, but persist only byte-free text evidence and bounded excerpts.
4. Extend Reddit submit postcondition logic so this real success shape is accepted:

```text
current URL: https://www.reddit.com/r/test/?created=t3_1t2zy4d...
canonical URL in LLM evidence: https://www.reddit.com/r/test/comments/1t2zy4d/
visible title: ai-vision status update 2026-05-03 screenshot scheduler online
```

5. Keep normal `/comments/<id>` success behavior.
6. Keep failure behavior when no evidence corroborates the post.
7. Route disagreement to HITL review with structured details instead of a blind failure.
8. Add byte-free telemetry for:
   - evidence parsed;
   - evidence accepted;
   - evidence rejected;
   - evidence escalated to HITL.

## Required Tests

Add focused tests covering:

1. `/comments/<id>` Reddit submit success still passes.
2. `?created=t3_<id>` plus matching title/body or canonical URL evidence passes.
3. `?created=t3_<id>` without corroborating title/body/canonical evidence does not pass.
4. LLM final output with malformed post-action evidence cannot bypass gates.
5. LLM success with deterministic disagreement enters HITL review with structured context.
6. Existing duplicate-check evidence gate remains intact.
7. Existing approval gate behavior remains intact.
8. Telemetry does not contain screenshot base64 or unbounded page content.

## Validation

Run and record:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand src/workflow/engine.test.ts src/ui/server.test.ts
```

Run full `pnpm test` if implementation touches shared workflow/HITL contracts beyond the focused surfaces.

## Closeout Requirements

At closeout, update:

1. `prd.json`
2. `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
3. `docs/artifacts/2026-05-03-us043-rf025-llm-post-action-review-evidence-contract-forge-story.yaml`
4. `docs/architecture/as-built_execution_atlas.md` if runtime ownership or flow changes materially
5. `progress.txt`
6. `docs/history/forge_history.md`
7. `docs/history/history_index.md`
8. Forge memory story state

The final response must include Summary of Work, files touched, acceptance criteria, and final validation result.

