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
| RF-002 | P1 | Workflow Engine | Unified step execution source | `resolvedDefinition` is built but execution flow can diverge from substituted step data if the wrong source is used in loop/control paths. | Step loop, telemetry naming, and wrap-up references use a single resolved step source consistently. | Core Workflow Team | Completed | `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `pnpm test -- src/workflow/engine.test.ts` |
| RF-003 | P0 | Memory Layer | FORGE-only SIC source of truth | Mirrored SIC writes across app DB/files and FORGE DB can drift and fracture promotion state. | SIC improvements/triggers write only to FORGE memory, app DB SIC column no longer receives writes, migration path exists for legacy data. | Core Workflow Team | Completed | `src/memory/forge-sic.ts`, `src/memory/long-term.ts`, `src/workflow/wrap-up.ts`, `src/db/repository.ts`, `scripts/forge/migrate-sic-to-forge.ts`, `npm run typecheck` |
| RF-004 | P0 | Workflow Kernel | Direct workflow gate layer design | The direct engine is the real production kernel, but it still lacks a generalized gate layer for skip logic, approval enforcement, HITL publication, side-effect policy, and output validation. `mode: agentic` currently fills some of that flexibility through a second execution semantics, which weakens determinism and state ownership. | A design package defines `GateDecision`, `GateContext`, gate insertion points in `src/workflow/engine.ts`, canonical HITL state ownership/publication rules, approval and side-effect gating rules, trace semantics for `run | skip | fail | hitl | retry`, and the minimum test map required before `mode: agentic` can be retired. | Core Workflow Team | Completed | `docs/artifacts/2026-04-24-direct-workflow-gate-layer-design.md`, `docs/artifacts/2026-04-24-direct-workflow-gate-layer-forge-story.yaml`, `docs/artifacts/2026-04-24-direct-workflow-gate-layer-storyline.md`, `docs/artifacts/2026-04-24-direct-workflow-gate-layer-implementation-handoff.md`, `docs/artifacts/2026-04-24-direct-workflow-gate-layer-definition-of-done.md` |
| RF-005 | P0 | Workflow Kernel | Direct workflow gate layer implementation — Phase 1 HITL state publication | The direct engine still publishes human-wait and terminal states through multiple partially coupled surfaces (`workflowEngine.currentState`, `hitlCoordinator`, `/api/status`, websocket state). That divergence weakens operator visibility and blocks later approval and side-effect gates from relying on one canonical public state path. | Implement a canonical direct-path state publication wrapper in `src/workflow/engine.ts`; route every direct HITL wait and terminal transition through it; keep `hitlCoordinator` as the blocking wait owner while making `/api/status`, websocket projection, and UI-visible action state converge on the same published workflow state; add regression tests for every wait/action surface required by the gate-layer design; do not remove `mode: agentic`. | Core Workflow Team | Completed | `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `src/session/hitl.ts`, `src/session/types.ts`, `docs/artifacts/2026-04-25-direct-workflow-hitl-state-publication-storyline.md`, `docs/artifacts/2026-04-25-direct-workflow-hitl-state-publication-forge-story.yaml`, `docs/artifacts/2026-04-25-direct-workflow-hitl-state-publication-implementation-handoff.md`, `docs/artifacts/2026-04-25-direct-workflow-hitl-state-publication-definition-of-done.md`, `pnpm run typecheck`, `pnpm test` |

## Enhancement Tracker

| ID | Priority | Area | Enhancement | Why | Acceptance Criteria | Owner | Status | Evidence |
|---|---|---|---|---|---|---|---|---|
| EN-001 | P1 | Workflow UX | Surface generated content preview before first browser step | Operators should see exact Gemini output before any irreversible browser interaction. | UI shows generated text/title in run context panel; value matches workflow outputs. | Unassigned | Proposed | Recent `write_and_post_to_x` run evidence in SQLite |
| EN-002 | P1 | Telemetry | Distinguish operational incidents from expected business outcomes | Alert panel should not escalate expected final confirmations/rejections as platform incidents. | Telemetry alerts exclude expected business-level failures; tests cover exclusions. | Completed | Completed | `src/telemetry/manager.ts`, `src/telemetry/manager.test.ts` |
| EN-003 | P2 | Content Pipeline | Add model/runtime metadata to workflow outputs | Helps diagnose generation drift and correlate failures by model. | Store generation metadata (`model`, `platform`, token/length metrics where available) in outputs or wrap-up artifacts. | Unassigned | Proposed | `workflow.generate_content.completed` telemetry event |
| EN-004 | P0 | CI/CD | GitHub Actions validation baseline | The repo has local quality gates but no automated branch validation, so regressions can land without typecheck/test/build coverage. | GitHub Actions installs dependencies with `pnpm`, then runs `pnpm run typecheck`, `pnpm test`, and `pnpm run build` on pushes and PRs targeting `main` and `forge/**`. | Core Workflow Team | Completed | `.github/workflows/ci.yml`, `pnpm run typecheck`, `pnpm test`, `pnpm run build` |
| EN-005 | P1 | Workflow UX | Trace Reddit draft propagation across LLM layers | The Reddit workflow can lose generated title/body context between Gemini drafting, workflow orchestration, and browser-use submission. | Emit a trace event that records the three-layer handoff (`Gemini draft -> workflow resolver -> browser-use submit`), the resolved title/body payload, and the step ids that consumed it. | Core Workflow Team | Proposed | Reddit run on 2026-04-23 showed an empty title/body handoff into the submit step |
| EN-007 | P1 | Tooling | TSC crash diagnostic classification baseline | Current `tsc --noEmit` memory failures can be misclassified as generic TypeScript regressions when the actual fault may be Node/V8 runtime skew or an OS kill path. | Investigation runbook records runtime versions and `NODE_OPTIONS`, compares behavior against CI-pinned Node 24, captures V8 and OS kill-path evidence, and reports `Instantiations`, `Memory used`, and `Check time` before classifying the failure layer. | Unassigned | Proposed | `docs/artifacts/tsc_crash_error_investigation.md`, `docs/artifacts/ts-memory-troubleshooting.md` |
| EN-006 | P1 | Tooling | TSC crash layered remediation protocol | Diagnostic results are not sufficient on their own; the repo also needs an explicit remediation gate that forces runtime parity first, separates Node/V8 versus OS fixes, and delays checker refactors until upstream layers are ruled out. | Remediation protocol requires Node 24 parity first, routes `SIGABRT` and `SIGKILL` to different remediation paths, blocks TypeScript refactors until runtime and OS layers are ruled out, and persists the chosen remediation as a classified bug report plus YAML story artifact. | Core Workflow Team | Completed | `docs/artifacts/tsc-crash-bug-report.md`, `docs/artifacts/tsc-crash-forge-story.yaml`, `docs/artifacts/tsc-crash-remediation-forge-story.yaml`, `docs/artifacts/2026-04-23-tsc-crash-remediation-implementation-handoff.md`, `pnpm exec tsc --noEmit` |
| EN-008 | P1 | Workflow / Startup Boundaries | Startup blind-spot seam closure | The audit still shows compile-time-only blind spots on the startup path: workflow step casting, workflow schema expansion, MCP server boundary casting, webhook payload inference, and UI websocket import casting. | Replace the audited startup casts and inferred boundary types with explicit typed helpers or exported interfaces, preserve startup behavior, and leave the audited path with no remaining `as unknown as`, `as any`, or inferred payload seams in the startup graph. | Core Workflow Team | Proposed | `docs/artifacts/telemetry-audit-2026-04-22.md`, `src/workflow/engine.ts`, `src/mcp/server.ts`, `src/webhooks/server.ts`, `src/ui/server.ts` |
| EN-009 | P1 | Forge Tooling | Forge workflow path normalization and CLI restoration | The live Forge implementation moved under `ForgeMP/`, but public workflow surfaces still referenced `scripts/forge/` and the repo no longer exposed a `pnpm run forge` entrypoint. That breaks preflight and handoff continuity. | `pnpm run forge` resolves to the live Forge runner, older `scripts/forge/*` command paths no longer fail, and active Forge governance docs identify `ForgeMP/` as canonical while documenting compatibility shims. | Core Workflow Team | Completed | `package.json`, `FORGE.md`, `ForgeMP/ForgeMP_modules.md`, `ForgeMP/MEMORY_PROTOCOL.md`, `ForgeMP/forge-memory-client.ts`, `scripts/forge/forge.sh`, `scripts/forge/forge-memory.sh`, `scripts/forge/forge-memory-client.ts`, `scripts/forge/forge.gates.example.sh`, `scripts/forge/migrate-sic-to-forge.ts`, `scripts/forge/MEMORY_PROTOCOL.md`, `scripts/forge/prompt.md`, `pnpm run typecheck`, `pnpm test`, `pnpm exec ts-node ForgeMP/forge-memory-client.ts messages` |
| EN-010 | P1 | Chief Engineer / Forge Tooling | Chief-engineer supervision daemon | The repo had no scheduled chief-engineer wake-up, so Forge storyline supervision depended on manual audits and could miss a stalled or off-branch story run. | A repo-owned daemon script performs a one-cycle chief-engineer observation, logs the active Forge storyline from `forge-memory.db`, and an idempotent installer registers a cron job that wakes the daemon every 5 minutes. | Core Workflow Team | Completed | `scripts/chief-engineer/chief-engineer-daemon.sh`, `scripts/chief-engineer/install-chief-engineer-cron.sh`, `crontab -l`, `pnpm run typecheck` |

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
