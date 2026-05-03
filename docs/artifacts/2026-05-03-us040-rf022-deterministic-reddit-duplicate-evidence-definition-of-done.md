# US-040 / RF-022 Definition Of Done

## Done Means

`US-040 / RF-022` is done when the direct Reddit workflow deterministically produces duplicate-check evidence without using browser-use for `check_duplicate_reddit_post`, while preserving the existing fail-closed submit gate.

## Required Outcomes

1. Direct `post_to_reddit` uses deterministic TypeScript/Playwright logic for `check_duplicate_reddit_post`.
2. Recent Reddit titles are collected from `/r/{subreddit}/new` with bounded selectors.
3. Collection is capped at `50` usable titles.
4. The implementation does not infinite-scroll.
5. The implementation computes word-level Jaccard scores in TypeScript.
6. `score >= 0.70` produces `DUPLICATE_RISK` and `MATCHING_TITLE`.
7. `0.50 <= score < 0.70` remains visible in `OVERLAP_SCORES` but does not create a third canonical result.
8. `score < 0.50` contributes to `NO_DUPLICATE_FOUND`.
9. The existing evidence parser accepts deterministic output.
10. The existing `submit_reddit_post` gate still blocks missing evidence and duplicate risk.
11. Zero usable titles, selector drift, and navigation failure fail closed.
12. Telemetry records selector success/failure and max score without screenshot bytes or large page dumps.

## Required Tests

Focused tests must prove:

1. title normalization;
2. Jaccard scoring;
3. duplicate threshold at `0.70`;
4. near-match behavior between `0.50` and `0.70`;
5. no-duplicate evidence formatting;
6. duplicate-risk evidence formatting with `MATCHING_TITLE`;
7. zero-title fail-closed behavior;
8. selector fallback behavior;
9. existing submit gate blocks duplicate risk;
10. direct `check_duplicate_reddit_post` does not dispatch to browser-use.

## Required Validation

The implementing agent must run and record:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand src/workflow/engine.test.ts
```

Run full `pnpm test` if shared workflow engine contracts are touched broadly.

## Governance Closeout

The implementing agent must update:

1. `prd.json`
2. `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
3. `docs/artifacts/2026-05-03-us040-rf022-deterministic-reddit-duplicate-evidence-forge-story.yaml`
4. `progress.txt`
5. `docs/history/forge_history.md`
6. `docs/history/history_index.md`
7. Forge memory story state

The final response must include Summary of Work, files touched, acceptance criteria, and final validation result.
