# SIC Refactor Enhancement Tracker

Date Created: 2026-04-19
Status: Active
Owner: Core Workflow Team

## Purpose

Promote learned runtime findings into first-class engineering work items with clear execution state, SIC impact, and contributor ownership.

This tracker is the canonical place to record:
- Refactors that close architectural gaps.
- Enhancements that improve runtime reliability and operator UX.
- SIC candidates and promotions tied to real workflow evidence.

## Scope

This tracker currently focuses on workflow-layer and memory-layer behavior for social publishing workflows, especially where generated content and browser automation interact.

## Operating Rules

1. Every row must have an owner and a status.
2. Every completed row must include evidence (PR, test, run id, or telemetry event).
3. Every SIC candidate must include repeatability evidence and proposed agent instruction text.
4. If a finding changes expected behavior, update `AGENTS.md` and `progress.txt` in the same change.
5. FORGE governance is mandatory for all tracker-driven refactors, enhancements, and version upgrades.

## Refactor Tracker

| ID | Priority | Area | Refactor | Problem | Acceptance Criteria | Owner | Status | Evidence |
|---|---|---|---|---|---|---|---|---|
| RF-001 | P0 | Workflow Engine | Runtime output-aware prompt substitution | `generate_content` writes runtime outputs (for example `x_post_text`), but downstream step prompts can execute without those values resolved in the same run. | `write_and_post_to_x` and `write_and_post_to_reddit` consume generated text/title in downstream steps deterministically; add regression tests for same-run substitution. | Core Workflow Team | Completed | `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `npm test -- src/workflow/engine.test.ts`, `npm run typecheck` |
| RF-002 | P1 | Workflow Engine | Unified step execution source | `resolvedDefinition` is built but execution flow can diverge from substituted step data if the wrong source is used in loop/control paths. | Step loop, telemetry naming, and wrap-up references use a single resolved step source consistently. | Unassigned | Proposed | Analysis from 2026-04-19 social workflow debug |
| RF-003 | P0 | Memory Layer | FORGE-only SIC source of truth | Mirrored SIC writes across app DB/files and FORGE DB can drift and fracture promotion state. | SIC improvements/triggers write only to FORGE memory, app DB SIC column no longer receives writes, migration path exists for legacy data. | Core Workflow Team | Completed | `src/memory/forge-sic.ts`, `src/memory/long-term.ts`, `src/workflow/wrap-up.ts`, `src/db/repository.ts`, `scripts/forge/migrate-sic-to-forge.ts`, `npm run typecheck` |

## Enhancement Tracker

| ID | Priority | Area | Enhancement | Why | Acceptance Criteria | Owner | Status | Evidence |
|---|---|---|---|---|---|---|---|---|
| EN-001 | P1 | Workflow UX | Surface generated content preview before first browser step | Operators should see exact Gemini output before any irreversible browser interaction. | UI shows generated text/title in run context panel; value matches workflow outputs. | Unassigned | Proposed | Recent `write_and_post_to_x` run evidence in SQLite |
| EN-002 | P1 | Telemetry | Distinguish operational incidents from expected business outcomes | Alert panel should not escalate expected final confirmations/rejections as platform incidents. | Telemetry alerts exclude expected business-level failures; tests cover exclusions. | Completed | Completed | `src/telemetry/manager.ts`, `src/telemetry/manager.test.ts` |
| EN-003 | P2 | Content Pipeline | Add model/runtime metadata to workflow outputs | Helps diagnose generation drift and correlate failures by model. | Store generation metadata (`model`, `platform`, token/length metrics where available) in outputs or wrap-up artifacts. | Unassigned | Proposed | `workflow.generate_content.completed` telemetry event |
| EN-004 | P0 | CI/CD | GitHub Actions validation baseline | The repo has local quality gates but no automated branch validation, so regressions can land without typecheck/test/build coverage. | GitHub Actions installs dependencies with `pnpm`, then runs `pnpm run typecheck`, `pnpm test`, and `pnpm run build` on pushes and PRs targeting `main` and `forge/**`. | Core Workflow Team | Completed | `.github/workflows/ci.yml`, `pnpm run typecheck`, `pnpm test`, `pnpm run build` |

## SIC Tracker

| SIC ID | Category | Candidate Pattern | Trigger Evidence | Proposed Instruction | Occurrences | Promotion Threshold | Status | Owner |
|---|---|---|---|---|---|---|---|---|
| SIC-CAND-001 | social-publish | Generated content must be resolved and frozen before publish path | `write_and_post_to_x` downstream steps observed blank content despite generated output present | "Before drafting/publishing, resolve generated content from workflow outputs and verify non-empty payload in-step; fail fast on missing content." | 1 | 10 | Candidate | Unassigned |
| SIC-CAND-002 | workflow-integrity | Terminal classification should use failure-local context only | Misclassification risk when classifier scans all prior step output | "Classify social outcome from terminal failure and immediate predecessor evidence, not full run text." | 1 | 10 | Applied (pre-promotion) | Core Workflow Team |

## Contributors

### Current Contributors

| Name | Role | Focus Area | Start Date | Contact | Notes |
|---|---|---|---|---|---|
| Core Workflow Team | Maintainer | Workflow engine, SIC pipeline | 2026-04-19 | Internal | Initial tracker owner |

### Add a Contributor

Add a row to the table above with:
- Name and role
- Focus area
- Start date
- Contact handle
- Optional notes (for example preferred review scope)

### Contribution Workflow

1. Pick an item from Refactor or Enhancement Tracker and assign yourself.
2. Add an implementation note under that item in your PR description.
3. Link test/run evidence in the Evidence column when complete.
4. If SIC-relevant, add or update a SIC row with occurrence evidence.
5. Update `progress.txt` and, if pattern-level behavior changed, update `AGENTS.md`.

## Change Log

- 2026-04-19: Tracker created and seeded with Gemini workflow propagation refactor and related SIC candidates.
