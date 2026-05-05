# US-045 / RF-027 Storyline: Stagehand Blast-Radius Release Cleanup

Use the Forge system and Forge build loop for this story.

## Problem

Stagehand is no longer an active ai-vision runtime engine, but historical Stagehand language still exists across root docs, debriefs, config naming, and stale package metadata.

Runtime blast radius is low:

- `src/engines/interface.ts` exposes only `browser-use | skyvern`.
- `src/engines/registry.ts` registers only `browser-use` and `skyvern`.
- `src/cli/index.ts` advertises only `browser-use | skyvern`.
- `src/engines/stagehand/` does not exist.

Release and contributor blast radius is higher:

- old root docs still describe Stagehand as active or broken;
- some reports still describe three engines;
- `STAGEHAND_LLM_*` names still appear in config tooling/scripts even though Stagehand is removed;
- stale `package-lock.json` can preserve a removed Stagehand dependency even though `pnpm-lock.yaml` is the active lockfile;
- copywriters and release reviewers can accidentally resurrect the obsolete three-engine story.

## Goal

Clean up the Stagehand blast radius before public release while preserving legitimate historical records.

The system should make it obvious that:

1. Stagehand was implemented early;
2. Stagehand was removed by `US-005` due dual-browser/session drift;
3. current runtime engines are `browser-use` and `skyvern`;
4. current LLM config surfaces use neutral ai-vision/browser-use names, not `STAGEHAND_*`;
5. stale lockfile or root-doc residue cannot mislead release workflows.

## Scope

In scope:

1. Preserve `prd.json` and `progress.txt` history, but add or preserve explicit notes that `US-005` removed Stagehand.
2. Add historical banners to old reports that still describe Stagehand as active or broken.
3. Remove, archive, or clearly mark stale root-level Stagehand docs that are not release-facing.
4. Rename active `STAGEHAND_LLM_*` config surfaces to neutral `AI_VISION_LLM_*` or `BROWSER_USE_LLM_*` names.
5. Preserve backward-compatible reads from legacy `STAGEHAND_LLM_*` env vars during a transition if needed.
6. Update `.env.example`, README, Rust config GUI, Vault scripts, and runtime provider resolution to use neutral names.
7. Regenerate or remove stale `package-lock.json` if `pnpm-lock.yaml` is the actual lockfile.
8. Add validation that no release-facing doc claims Stagehand runtime support.
9. Add focused tests or scripted validation for config-name fallback and current engine inventory.

Out of scope:

1. Re-adding Stagehand.
2. Designing a new Stagehand shared-CDP adapter.
3. Changing `browser-use` or `skyvern` runtime behavior beyond config-name normalization.
4. Rewriting every historical artifact.
5. Removing legitimate history from `prd.json`, `progress.txt`, Forge history, or debrief archives.

## Acceptance Criteria

1. `prd.json` and `progress.txt` preserve historical Stagehand entries and clearly indicate Stagehand was removed by `US-005`.
2. Old reports that describe Stagehand as active have historical/not-current-source banners.
3. Root-level stale Stagehand docs are either archived under docs/debriefs, marked historical, or removed if redundant.
4. Active config tooling no longer writes `STAGEHAND_LLM_*` as the primary LLM config names.
5. Runtime provider/model resolution reads neutral env vars first.
6. Legacy `STAGEHAND_LLM_*` env vars remain backward-compatible for one transition window or are explicitly documented as removed.
7. `.env.example`, README, Vault scripts, Rust config GUI, and LLM config docs are aligned on neutral names.
8. `package-lock.json` no longer preserves stale Stagehand dependency metadata, or the repo documents why it remains.
9. Current engine inventory still reports only `browser-use` and `skyvern`.
10. Release-facing docs do not claim `stagehand`, `3 engines`, or `--engine stagehand`.
11. `jq empty prd.json` passes.
12. `pnpm run typecheck` passes.
13. Focused config/engine tests pass.

## Exit Criteria

Exit only when Stagehand can no longer be mistaken for an active runtime feature by release copy, config tooling, package metadata, or contributor-facing docs, while historical records still explain why it was removed.

