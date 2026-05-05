# US-045 / RF-027 Definition Of Done

`US-045 / RF-027` is done when Stagehand cannot be mistaken for an active runtime feature by release copy, contributor docs, config tooling, or package metadata, while historical records still explain why it was removed.

## Functional Requirements

1. Current runtime engine inventory remains `browser-use` and `skyvern`.
2. CLI/runtime do not accept `stagehand` as an engine.
3. Active LLM config surfaces use neutral `AI_VISION_LLM_*` or agreed equivalent names.
4. Browser-use model/provider resolution reads neutral env vars first.
5. Legacy `STAGEHAND_LLM_*` env vars are either supported as fallback for one transition window or explicitly removed and documented.
6. Rust config GUI writes neutral env names.
7. Vault scripts write/export neutral env names.
8. `.env.example`, README, and LLM config docs are aligned.
9. Stale `package-lock.json` Stagehand metadata is removed or explicitly justified.

## Documentation Requirements

1. `prd.json` and `progress.txt` preserve historical Stagehand records.
2. Historical notes clearly state Stagehand was removed by `US-005`.
3. Root-level stale Stagehand docs are archived, marked historical, or removed if redundant.
4. Old reports that still describe Stagehand as active have historical/not-current-source banners.
5. Release-facing docs do not claim active Stagehand, three engines, or `--engine stagehand`.

## Validation Requirements

The build agent must run and record:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand src/engines/registry.test.ts src/cli/index.test.ts
rg -n "stagehand|Stagehand|3 engines|3 swappable engines|--engine stagehand" README.md docs/reports
```

The stale-claim scan is expected to return no release-facing active-support claims. If it returns intentional historical references, each must be explicitly justified in the closeout.

## Governance Requirements

1. `prd.json` marks `US-045` complete only after implementation and validation.
2. `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md` marks `RF-027` complete only after implementation and validation.
3. The Forge story YAML status moves from `proposed` to `completed`.
4. `progress.txt` includes Summary of Work, files touched, acceptance criteria, and final validation result.
5. `docs/history/forge_history.md` and `docs/history/history_index.md` are updated after implementation completion.
6. Forge memory is updated with story outcome and durable discoveries.

