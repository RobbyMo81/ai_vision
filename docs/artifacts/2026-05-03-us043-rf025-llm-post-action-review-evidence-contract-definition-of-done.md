# US-043 / RF-025 Definition Of Done

## Done Means

`US-043 / RF-025` is done when side-effecting LLM/browser-use steps produce structured post-action review evidence that deterministic workflow gates can corroborate, reject, or escalate to HITL review.

The LLM must be used for reasoning over messy UI outcomes, but it must not become unchecked final authority for irreversible action success.

## Required Outcomes

1. A typed `PostActionReviewEvidence` or equivalent contract exists.
2. Browser-use final output can be parsed into structured post-action evidence.
3. Reddit submit postconditions accept normal `/comments/<id>` success URLs.
4. Reddit submit postconditions accept Reddit `?created=t3_<id>` redirects only with corroborating evidence.
5. Missing, malformed, or low-confidence LLM evidence cannot bypass deterministic gates.
6. LLM-success/deterministic-failure disagreement enters HITL review with structured context.
7. HITL review context includes step id, deterministic failure reason, LLM success signal, current URL, canonical URL, and match status where available.
8. Telemetry records evidence parsed, accepted, rejected, and escalated decisions without screenshot bytes.
9. Existing duplicate-check, approval, screenshot, and browser postcondition gates remain compatible.
10. No US-042 screenshot TTL cleanup is implemented in this story.

## Required Tests

Focused tests must prove:

1. `/comments/<id>` Reddit success still passes.
2. `?created=t3_<id>` plus corroborated LLM/DOM evidence passes.
3. `?created=t3_<id>` without corroboration does not pass.
4. Malformed LLM evidence fails closed.
5. LLM success versus deterministic disagreement creates HITL review instead of a false terminal failure.
6. Duplicate-check and approval gates still protect submit.
7. Telemetry is byte-free and bounded.

## Required Validation

The implementing agent must run and record:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand src/workflow/engine.test.ts src/ui/server.test.ts
```

Run full `pnpm test` if shared workflow/HITL contracts are touched broadly.

## Governance Closeout

The implementing agent must update:

1. `prd.json`
2. `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
3. `docs/artifacts/2026-05-03-us043-rf025-llm-post-action-review-evidence-contract-forge-story.yaml`
4. `docs/architecture/as-built_execution_atlas.md` if runtime flow changes materially
5. `progress.txt`
6. `docs/history/forge_history.md`
7. `docs/history/history_index.md`
8. Forge memory story state

The final response must include Summary of Work, files touched, acceptance criteria, and final validation result.

