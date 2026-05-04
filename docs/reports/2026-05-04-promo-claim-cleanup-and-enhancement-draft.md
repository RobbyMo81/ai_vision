# Promo Claim Cleanup And Enhancement Draft

Date: 2026-05-04
Status: Draft
Source: Orchestrator review of `docs/reports/ai_vision_promo_campaign.md`

## Context

The promo campaign uncovered release-readiness drift between current runtime behavior, historical architecture docs, and marketing copy. This draft captures cleanup actions and possible implementation stories that can be promoted into Forge workflows later.

## Release Cleanup Candidates

### 1. Fix Promo Copy

Replace inaccurate or overbroad claims:

- Replace "3 swappable engines" with "2 runtime engines today: `browser-use` and `skyvern`."
- Remove every `stagehand` runtime promo claim.
- Replace `--engine stagehand` examples with `--engine skyvern`.
- Replace "No CSS selectors" with "natural-language-first automation with deterministic guardrails."
- Replace "production-ready stack" with "actively hardened" or "release-candidate stack."

Reason: current runtime exposes only `browser-use` and `skyvern`; deterministic selector-backed guardrails still exist.

### 2. Mark Stale Architecture Docs As Historical

Docs that still contain stale Stagehand or three-engine framing:

- `docs/debriefs/CTO Technical Report.md`
- `docs/debriefs/AI_VISION_V2_BLUEPRINT.md`

Suggested treatment:

- Add a short banner: "Historical snapshot, not current runtime source of truth."
- Keep the historical material intact unless a future story explicitly asks for full rewrite.

### 3. Clarify Stagehand In Governance

Current historical shape:

- `US-003` implemented a Stagehand wrapper.
- `US-005` removed Stagehand because it caused dual-browser/session drift.

Suggested release-note wording:

> Stagehand was implemented early and removed by `US-005` due dual-browser drift. Current runtime engines are `browser-use` and `skyvern`.

### 4. Update Release Positioning

Current accurate positioning:

- TypeScript CLI
- `browser-use` bridge
- optional `skyvern` bridge
- HITL control panel
- SQLite history
- Rust config GUI
- Vault-supported local secrets
- Forge governance and release hardening

## Enhancement Candidates

### Enhancement 1: Release Claim Verifier

Build a lightweight script that scans promo/release docs for risky or stale claims.

Initial blocked/warned terms:

- `stagehand`
- `3 engines`
- `3 swappable engines`
- `production-ready`
- `no selectors`
- `No CSS selectors`
- `--engine stagehand`

Expected behavior:

- Run from lint or a dedicated release command.
- Emit actionable file/line diagnostics.
- Allow intentional historical references only when marked as historical.

### Enhancement 2: Engine Capability Surface

Add a generated capability report from actual runtime registry and dependency checks.

Potential command:

```bash
node dist/cli/index.js engines --json
```

or:

```bash
node dist/cli/index.js doctor
```

Output should include:

- runtime engines available from registry;
- dependency readiness for optional engines;
- supported LLM providers;
- known limitations;
- suggested copy-safe engine wording.

### Enhancement 3: Public Demo Smoke Suite

Add release-safe demo workflows that validate examples used in public copy.

Candidate demos:

- Hacker News top stories read-only extraction.
- GitHub trending read-only extraction.
- `example.com` form/navigation smoke where applicable.

Purpose:

- Prevent marketing examples from drifting away from runtime behavior.
- Provide safe public demos for contributors.

### Enhancement 4: Marketing Source Of Truth

Create `docs/reports/release_claims.md`.

Every public claim should map to evidence:

- source file;
- command;
- test;
- GitHub fact;
- history reference.

Copywriters should use this file instead of PRD history or old architecture reports.

### Enhancement 5: Stagehand Re-Evaluation Design

Do not casually re-add Stagehand. It was removed for dual-browser drift.

If Stagehand is desired again, promote a design story first:

> Can Stagehand attach to shared CDP without breaking HITL/session ownership?

Required design topics:

- shared Chrome/CDP compatibility;
- HITL browser visibility;
- session ownership;
- screenshot policy compatibility;
- engine registry implications;
- migration path from removed Stagehand history.

## Recommended Next Forge Story Candidate

`US-045 / RF-027: Release Claim Reconciliation And Promo Guardrails`

Potential scope:

- Correct `docs/reports/ai_vision_promo_campaign.md`.
- Add release-claim source-of-truth doc.
- Add stale-doc historical banners.
- Add a claim verifier script or lint rule.
- Add validation that `prd.json` remains valid.

Out of scope:

- Re-adding Stagehand.
- Changing browser automation runtime behavior.
- Rewriting all historical docs.
- Running live external demo workflows.

