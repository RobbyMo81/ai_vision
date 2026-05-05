# US-045 / RF-027 Implementation Handoff

## Agent Prompt

You are the build agent for `US-045 / RF-027: Stagehand Blast-Radius Release Cleanup`.

Use the Forge system and the Forge build loop explicitly. Before editing code, read:

1. `FORGE.md`
2. `AGENTS.md`
3. `prd.json`
4. `progress.txt`
5. `docs/artifacts/2026-05-04-us045-rf027-stagehand-blast-radius-release-cleanup-storyline.md`
6. `docs/artifacts/2026-05-04-us045-rf027-stagehand-blast-radius-release-cleanup-forge-story.yaml`
7. `docs/artifacts/2026-05-04-us045-rf027-stagehand-blast-radius-release-cleanup-definition-of-done.md`
8. `src/engines/interface.ts`
9. `src/engines/registry.ts`
10. `src/cli/index.ts`
11. `src/engines/browser-use/server/main.py`
12. `tools/config-gui/src/main.rs`
13. `scripts/secrets/vault-init.sh`
14. `.env.example`
15. `README.md`
16. `LLM_MODEL_IMPACT.md`

## Build Intent

Remove the release and contributor confusion left by historical Stagehand logic without re-adding Stagehand or deleting legitimate history.

The current product truth is:

- runtime engines: `browser-use`, `skyvern`;
- Stagehand was removed by `US-005` because it caused dual-browser/session drift;
- active LLM configuration should not use `STAGEHAND_*` names.

## Required Implementation Shape

1. Preserve historical governance.
   - Do not delete `US-003` or `US-005` from `prd.json`.
   - Do not remove historical progress entries.
   - Add a concise current-state note where needed: Stagehand was removed by `US-005`; current runtime engines are `browser-use` and `skyvern`.

2. Mark stale reports historical.
   - Add a banner to root or debrief reports that still describe Stagehand as active.
   - Do not rewrite full historical documents unless needed for clarity.

3. Clean root-level stale docs.
   - For non-release root docs that mainly describe obsolete Stagehand behavior, either move them under `docs/debriefs/` with a historical prefix or add a clear historical banner.
   - Keep release-facing docs in the repo root accurate.

4. Rename active LLM config surfaces.
   - Prefer neutral names such as:
     - `AI_VISION_LLM_PROVIDER`
     - `AI_VISION_LLM_MODEL`
     - `AI_VISION_LLM_MODEL_ANTHROPIC`
     - `AI_VISION_LLM_MODEL_OPENAI`
     - `AI_VISION_LLM_FALLBACK_PROVIDER`
   - Update active writers/readers:
     - Rust config GUI;
     - browser-use provider resolution;
     - Vault init/export scripts;
     - `.env.example`;
     - README/config docs.
   - Preserve legacy reads from `STAGEHAND_LLM_*` for one transition window if simple and safe.

5. Resolve stale lock metadata.
   - If `pnpm-lock.yaml` is canonical, remove or regenerate stale `package-lock.json`.
   - Do not leave a lockfile that advertises `@browserbasehq/stagehand` unless a clear reason remains.

6. Add validation.
   - Add focused tests for engine inventory if not already sufficient.
   - Add focused config tests if config fallback behavior is changed.
   - Add a stale-claim scan command to the closeout evidence.

## Required Tests

At minimum:

1. Current engine inventory remains `browser-use` and `skyvern`.
2. CLI rejects `--engine stagehand`.
3. Browser-use config resolution prefers neutral env names.
4. Legacy `STAGEHAND_LLM_*` fallback works or is explicitly removed with tests/docs.
5. Release-facing docs do not claim active Stagehand support.

## Validation

Run and record:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand src/engines/registry.test.ts src/cli/index.test.ts
rg -n "stagehand|Stagehand|3 engines|3 swappable engines|--engine stagehand" README.md docs/reports
```

Run broader tests if config or engine interfaces change beyond the focused surfaces.

## Closeout Requirements

At closeout, update:

1. `prd.json`
2. `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
3. `docs/artifacts/2026-05-04-us045-rf027-stagehand-blast-radius-release-cleanup-forge-story.yaml`
4. `docs/architecture/as-built_execution_atlas.md` if runtime config ownership changes materially
5. `progress.txt`
6. `docs/history/forge_history.md`
7. `docs/history/history_index.md`
8. Forge memory story state

The final response must include Summary of Work, files touched, acceptance criteria, and final validation result.

