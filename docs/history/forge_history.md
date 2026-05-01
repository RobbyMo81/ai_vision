# forge_history.md — FORGE Story Archive

This file is the canonical long-form archive of completed FORGE story history entries.

## Append SOP (Mandatory)

When a story is completed and validated:
1. Add a new entry at the end of this file using the standard story template.
2. Keep entries append-only in chronological order (oldest to newest).
3. Include: Story ID, title, date, status, pattern, gotcha, and touched files.
4. Update docs/history/history_index.md in the same change with a new library card row.
5. Do not append story payloads to AGENTS.md; AGENTS.md should only contain current governance and pointers.

## Story Template

### [STORY-ID] — Story Title — YYYY-MM-DD

**Status:** PASS|FAIL|BLOCKED
**Pattern:** One-sentence reusable pattern.
**Gotcha:** One-sentence warning for future agents.
**Files:** `path/a`, `path/b`

## Story History

<!-- Each agent appends one section below after completing a story -->

### [US-005] — Production HITL Hardening — 2026-04-18

**Status:** PASS
**Pattern:** Centralize workflow teardown in `wrap-up.ts`, keep encrypted pre-flight values in short-term memory only, and gate sensitive entry through explicit schema metadata plus phase-aware HITL UI.
**Gotcha:** Durable profiles require both the CDP startup path and the Playwright fallback path to use persistent browser state; fixing only one path is insufficient.
**Files:** `src/workflow/engine.ts`, `src/workflow/wrap-up.ts`, `src/workflow/types.ts`, `src/memory/short-term.ts`, `src/memory/types.ts`, `src/memory/indexer.ts`, `src/memory/metadata.ts`, `src/session/hitl.ts`, `src/session/types.ts`, `src/session/manager.ts`, `src/ui/server.ts`, `src/db/repository.ts`, `src/db/migrations/002_workflow_runs.sql`, `src/utils/crypto.ts`

### [US-006] — Layered Telemetry Workflow — 2026-04-18

**Status:** PASS
**Pattern:** Emit typed telemetry events at workflow/session/HITL/UI boundaries, persist them to SQLite and NDJSON, and let a detector layer escalate only the operationally relevant failures into alerts.
**Gotcha:** UI visibility is only useful if it reflects current state on page load; the telemetry panel and the HITL state both require an initial fetch, not just WebSocket deltas.
**Files:** `src/telemetry/manager.ts`, `src/telemetry/types.ts`, `src/telemetry/index.ts`, `src/workflow/engine.ts`, `src/workflow/wrap-up.ts`, `src/session/manager.ts`, `src/session/hitl.ts`, `src/ui/server.ts`, `src/db/repository.ts`, `src/db/migrations/003_telemetry.sql`, `src/index.ts`

### [US-007] — HITL Terminal-State UX Fix — 2026-04-19

**Status:** PASS
**Pattern:** Treat `complete` and `error` as terminal UI states, stop client reconnect/poll loops once reached, and give the CLI a short shutdown grace period so the final phase update reaches the browser before process exit.
**Gotcha:** In `ai-vision workflow ...`, the localhost HITL UI and the workflow runner share one process; a clean workflow completion can look like a network failure if the page does not know the session is already terminal.
**Files:** `src/ui/server.ts`, `src/cli/index.ts`, `src/session/types.ts`

### [US-008] — Final-Step HITL Confirmation Model — 2026-04-19

**Status:** PASS
**Pattern:** Use `human_takeover` in `confirm_completion` mode for irreversible end states so the agent performs the final action and HITL only confirms whether the visible outcome is correct.
**Gotcha:** Do not overload `hitl_qa` for optional note capture; if `/api/acknowledge` changes the phase, the UI can accidentally show a final-confirmation button when no verification step is actually pending.
**Files:** `src/workflow/types.ts`, `src/workflow/engine.ts`, `src/session/hitl.ts`, `src/ui/server.ts`, `src/session/types.ts`

### [US-009] — SIC Self-Heal On Final-Step Rejection — 2026-04-19

**Status:** PASS
**Pattern:** When HITL rejects a final-step confirmation, capture the operator’s reason immediately, emit a dedicated rejection telemetry event, record a reusable improvement, and force a failure-mode SIC trigger in wrap-up.
**Gotcha:** Optional QA comments are not reliable enough for self-heal; the rejection endpoint itself must carry the reason or the SIC loop will silently lose the most important failure context.
**Files:** `src/session/types.ts`, `src/memory/types.ts`, `src/session/hitl.ts`, `src/workflow/engine.ts`, `src/ui/server.ts`, `src/workflow/wrap-up.ts`

### [US-010] — HITL QA Pause And Authenticated Login Skip — 2026-04-19

**Status:** PASS
**Pattern:** Add a dedicated pre-wrap-up QA-notes pause and use the generic `authVerification` contract on recurring login gates so HITL can record portal learnings without forcing avoidable login handoffs.
**Gotcha:** Login skipping must be opt-in and portal-specific; URL-only checks are too weak for authenticated workflows and can create false skips.
**Files:** `src/session/types.ts`, `src/workflow/types.ts`, `src/session/hitl.ts`, `src/workflow/engine.ts`, `src/ui/server.ts`

### [US-011] — Browser-Use Sequential Session Recovery And External-Failure Handoff — 2026-04-19

**Status:** PASS
**Pattern:** Treat `browser-use` session state as per-task recoverable state; if the library resets its event bus or session manager after one agent run, recreate a fresh `BrowserSession` before the next run instead of attempting shallow CDP-only repair.
**Gotcha:** Once `browser-use` calls `stop()`/`reset()`, the session object can still exist but no longer has the handlers required for `BrowserStateRequestEvent`; that produces misleading second-step failures unless the bridge detects and replaces the object.
**Files:** `src/engines/browser-use/server/main.py`, `docs/artifacts/2026-04-19-x-hitl-fine-tuning-handoff.md`

### [US-012] — Telemetry Alert Noise And Bridge Port Recovery — 2026-04-19

**Status:** PASS
**Pattern:** Treat final HITL confirmation rejection and similar business-level workflow outcomes as structured run results rather than operational incidents, and recover orphaned Python bridge ports by asking the old bridge to `/close` before declaring the engine unavailable.
**Gotcha:** Social outcome classification must use the terminal failure context; scanning every prior step output can misclassify later failures because earlier draft/composer text leaks into the classifier.
**Files:** `src/engines/python-bridge.ts`, `src/telemetry/manager.ts`, `src/telemetry/manager.test.ts`, `src/workflow/engine.ts`

### [US-013] — RF-001 Runtime Output Substitution Fix — 2026-04-19

**Status:** PASS
**Pattern:** Resolve each workflow step against live runtime context (`resolvedParams + outputs`) immediately before execution so placeholders from earlier same-run steps (for example `{{x_post_text}}`) are available downstream.
**Gotcha:** Pre-resolving all steps once at run start can erase unresolved placeholders to empty strings before runtime outputs exist, causing downstream post/draft steps to miss generated content.
**Files:** `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`

### [US-014] — FORGE SIC Memory Remap And Governance Enforcement — 2026-04-19

**Status:** PASS
**Pattern:** Treat `forge-memory.db` as the primary SIC persistence layer for improvements and self-heal triggers so runtime learning and governance evidence share one authoritative memory surface.
**Gotcha:** FORGE DB may be unavailable in non-FORGE runtime contexts; keep a deterministic local fallback path while emitting explicit telemetry when FORGE persistence is skipped.
**Files:** `src/memory/forge-sic.ts`, `src/memory/long-term.ts`, `src/memory/index.ts`, `src/workflow/wrap-up.ts`, `FORGE.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `README.md`, `progress.txt`

### [US-015] — FORGE-Only SIC Source Of Truth Cutover — 2026-04-19

**Status:** PASS
**Pattern:** Enforce a single SIC writer path to FORGE (`context_store`) and treat mirrored app/file SIC writes as policy violations to prevent drift in promotion state and self-heal history.
**Gotcha:** Strict FORGE SIC mode will fail persistence when `forge-memory.db` is missing/misaligned; run the migration command before enabling strict mode in legacy environments.
**Files:** `src/memory/forge-sic.ts`, `src/memory/long-term.ts`, `src/workflow/wrap-up.ts`, `src/db/repository.ts`, `scripts/forge/migrate-sic-to-forge.ts`, `package.json`, `.env.example`, `README.md`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`

### [US-016] — Bridge Disconnect Signal Parity Across UI And MCP — 2026-04-19

**Status:** PASS
**Pattern:** Route bridge process-exit handling through one shared lifecycle path, then fan out disconnect visibility to both HITL WebSocket and MCP `session_status` so operators and MCP clients receive the same failure signal.
**Gotcha:** Only unexpected exits from initialized bridges should raise operator-facing alerts; expected shutdowns (for example SIGTERM during close) must be tracked but not escalated as incidents.
**Files:** `src/engines/python-bridge.ts`, `src/ui/server.ts`, `src/mcp/server.ts`, `src/session/types.ts`, `src/engines/python-bridge.test.ts`, `src/mcp/server.test.ts`, `progress.txt`

### [US-017] — Local Secrets Vault Container Baseline — 2026-04-19

**Status:** PASS
**Pattern:** Keep runtime API keys out of `.env` by running a local Vault container and loading secrets into process environment at shell runtime (`eval` export flow) before starting ai-vision commands.
**Gotcha:** Vault bootstrap/export scripts depend on `curl` + `jq`; missing either tool will fail secret seeding/loading even when the container is healthy.
**Files:** `docker-compose.vault.yml`, `scripts/secrets/vault-init.sh`, `scripts/secrets/vault-export-env.sh`, `package.json`, `.env.example`, `README.md`, `progress.txt`

### [US-018] — GitHub Actions CI Baseline — 2026-04-19

**Status:** PASS
**Pattern:** Keep repository validation in one GitHub Actions workflow that installs from the pinned `pnpm` lockfile and runs typecheck, tests, and build on both push and PR paths for `main` and `forge/**`.
**Gotcha:** The repo now declares `pnpm` as its package manager, so validating with `npm` in CI can drift from the lockfile and silently exercise a different dependency graph than local development.
**Files:** `.github/workflows/ci.yml`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`

### [US-019] — Unified Resolved Step Source And Proxy-Safe Workflow Loop — 2026-04-21

**Status:** PASS
**Pattern:** Capture the workflow step array before building `resolvedDefinition`, then route the loop and terminal references through that resolved source so later getter side effects cannot swap in a different step list.
**Gotcha:** Spreading a workflow definition can re-trigger a `steps` getter; capture the array once before the spread or the loop can drift to a different source on proxy-like definitions.
**Files:** `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`

### [US-020] — TypeScript Heap Exhaustion Containment — 2026-04-23

**Status:** PASS
**Pattern:** Keep runtime schemas local to their owning module and cross subsystem boundaries with static interfaces or DTOs; then contain SDK generic inference behind one non-generic helper so the TypeScript checker sees stable symbols instead of re-expanding full schema graphs.
**Gotcha:** Neutralizing only one expansion node can delay the `tsc` crash without fixing it; if the heap abort moves later in the run, step to the next broad generic boundary instead of assuming the first seam was sufficient.
**Files:** `src/workflow/types.ts`, `src/workflow/engine.ts`, `src/mcp/server.ts`, `src/mcp/server.test.ts`, `src/webhooks/server.test.ts`, `README.md`, `docs/debriefs/tsc-crash-bug-report.md`, `progress.txt`

### [US-021] — Forge Handoff Package Policy — 2026-04-22

**Status:** PASS
**Pattern:** Require a four-part engineering handoff package for every build task: a first-class Forge storyline, a compact YAML tracing story card when applicable, an agent prompt that instructs the Forge build loop, and an explicit definition of done.
**Gotcha:** If the handoff omits any required artifact, future agents will have to reconstruct missing context before they can start the build safely.
**Files:** `AGENTS.md`, `FORGE.md`, `progress.txt`

### [EN-008] — Startup Blind-Spot Seam Closure — 2026-04-22

**Status:** PASS
**Pattern:** Replace each audited startup cast or inferred-type seam with an explicit named boundary: a `toWorkflowStep` conversion helper in engine.ts, a `parseWorkflowDefinition` DTO function in types.ts, a `ToolRegistrar` interface in mcp/server.ts, an explicit `TriggerPayload` interface in webhooks/server.ts, and a destructured typed ws import in ui/server.ts. Cast once at the object-construction boundary for McpServer; keep schema graph expansion local to types.ts.
**Gotcha:** `Record<string, unknown>` to `WorkflowStep` cannot single-cast — TypeScript requires `as unknown as`. The story goal is a named boundary that makes the conversion visible, not eliminating every cast instruction.
**Files:** `src/workflow/engine.ts`, `src/workflow/types.ts`, `src/orchestrator/loader.ts`, `src/mcp/server.ts`, `src/webhooks/server.ts`, `src/ui/server.ts`, `progress.txt`

### [EN-009] — Forge Workflow Path Normalization — 2026-04-24

**Status:** PASS
**Pattern:** Keep `ForgeMP/` as the canonical Forge implementation tree, but provide thin compatibility entrypoints under `scripts/forge/` so older handoffs and operator commands do not break when the implementation tree is relocated.
**Gotcha:** A documented workflow is broken even if the code exists; missing `pnpm run forge` and stale `scripts/forge/*` references are operator-facing defects, not just doc drift.
**Files:** `package.json`, `FORGE.md`, `ForgeMP/ForgeMP_modules.md`, `ForgeMP/MEMORY_PROTOCOL.md`, `ForgeMP/forge-memory-client.ts`, `scripts/forge/forge.sh`, `scripts/forge/forge-memory.sh`, `scripts/forge/forge-memory-client.ts`, `scripts/forge/forge.gates.example.sh`, `scripts/forge/migrate-sic-to-forge.ts`, `scripts/forge/prompt.md`, `scripts/forge/MEMORY_PROTOCOL.md`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`

### [US-022] — Direct Workflow Gate Layer Design — 2026-04-24

**Status:** PASS
**Pattern:** Design-only story. `GateDecision`/`GateContext`/`GateTrace`/`ApprovalState` contracts define the direct engine's gate layer. Seven insertion points mapped in `src/workflow/engine.ts`. `publishStateTransition()` closes the `hitlCoordinator`/`WorkflowEngine` phase-sync gap. `approve_step` added to `SessionState.hitlAction`. `mode: agentic` preserved — retirement requires passing the full 7-subsection test matrix in Section 7 of the design artifact.
**Gotcha:** The precondition gate replaces three separate inline short-circuit checks (auth skip in `human_takeover`, outputKey skip in `generate_content`, unresolved-var fail in `agent_task`) — lift those to the loop boundary before testing them independently. `approvalState` must be run-scoped (initialized once per `engine.run()`), not session-scoped, or it bleeds approval across concurrent runs.
**Files:** `docs/artifacts/2026-04-24-direct-workflow-gate-layer-design.md`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `prd.json`, `forge-memory.db`, `progress.txt`

### [EN-010] — Chief-Engineer Supervision Daemon — 2026-04-25

**Status:** PASS
**Pattern:** Use the existing chief-engineer observer as a one-cycle probe, then wrap it in a repo-owned daemon script plus an idempotent cron installer so supervision wakes on schedule and records the active Forge storyline.
**Gotcha:** A monitor that only checks generic repo health is too weak for Forge supervision; the wake-up path must query `forge-memory.db` for the active `agent_iterations` story and log that storyline explicitly.
**Files:** `scripts/chief-engineer/chief-engineer-daemon.sh`, `scripts/chief-engineer/install-chief-engineer-cron.sh`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `AGENTS.md`, `progress.txt`

### [US-023] — Direct Workflow Gate Layer Implementation (Phase 1 HITL State Publication) — 2026-04-25

**Status:** PASS
**Pattern:** Keep `workflowEngine.currentState` as the canonical public projection and publish direct wait/terminal state through one engine-owned state path; keep `hitlCoordinator` as the blocking wait owner, not a second public state machine.
**Gotcha:** A canonical wrapper is insufficient if any terminal path still calls `hitlCoordinator.setPhase(...)` directly or returns on preflight failure without publishing `phase: 'error'`; both bypasses must be removed or Phase 1 visibility remains incomplete.
**Files:** `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `prd.json`, `progress.txt`

### [EN-011] — Forge Lint And GitHub Actions Gate Enforcement — 2026-04-25

**Status:** PASS
**Pattern:** Make the committed Forge gate the same command local operators and GitHub Actions run: lint first, then typecheck, tests, and build through `pnpm run forge:gates`.
**Gotcha:** Forge silently skips quality enforcement when root `forge.gates.sh` is absent; an example gate under `ForgeMP/` is documentation, not an active gate.
**Files:** `scripts/lint.mjs`, `forge.gates.sh`, `.github/workflows/ci.yml`, `.github/workflows/forge.yml`, `ForgeMP/forge.gates.example.sh`, `package.json`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`

### [US-024] — Direct Workflow Gate Layer Phase 2: Final-Step Confirmation Pre-Flight Binding Enforcement — 2026-04-26

**Status:** PASS
**Pattern:** Gate `POST /api/confirm-final-step` with three pre-flight checks — run-phase (409), session binding (400), WebSocket presence (403) — before reaching `hitlCoordinator.confirmCompletion`; use one handler-scoped named const `emitConfirmationRejection` so every rejection path emits `ui.hitl.confirm_final_step.rejected` with a structured `gate` field; add parity caller-attribution trace to `/api/return-control` via body+header clientId resolution and `socketsForPage`.
**Gotcha:** `startUiServer` must return `Promise<http.Server>` for integration tests to bind an ephemeral port; tests that only mock the `ws` module at the top level must supply a `clients` Set on the mock `WebSocketServer` or `connectionCount()` will throw.
**Files:** `src/ui/server.ts`, `src/ui/server.test.ts`, `prd.json`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`

### [US-025] — Direct Workflow Gate Layer Phase 3: Return-Control Pre-Flight Binding Enforcement — 2026-04-26

**Status:** PASS
**Pattern:** Gate `POST /api/return-control` with one action-state gate plus run/session/client binding gates before `hitlCoordinator.returnControl()`; emit one structured rejection event through a handler-scoped helper and emit a completed event on successful resume using the same attribution shape.
**Gotcha:** The action gate must allow exactly four phase/action pairs (`awaiting_human:return_control`, `awaiting_human:verify_authentication`, `hitl_qa:approve_draft`, `hitl_qa:capture_notes`); widening this list without design review weakens the HITL resume perimeter.
**Files:** `src/ui/server.ts`, `src/ui/server.test.ts`, `prd.json`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`

### [US-026] — Direct Workflow Gate Layer Phase 4: Approval Gate Before Browser Side Effects — 2026-04-27

**Status:** PASS
**Pattern:** Enforce direct-path approval in `WorkflowEngine.run()` before `executeStep(...)` with run-scoped approval state keyed to protected step id/type selectors, publish `hitl_qa:approve_step` before blocking, and consume approval immediately after protected execution.
**Gotcha:** Approval state must be run-scoped and step-bound; reusing approval across steps or runs silently weakens the gate and allows side effects to bypass fresh operator approval.
**Files:** `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `src/ui/server.ts`, `src/ui/server.test.ts`, `prd.json`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `docs/debriefs/2026-04-26-hitl-gate-story-reference.md`, `progress.txt`

---

### [US-027] — Direct Workflow Gate Layer Phase 5: Content/Output Validation Gate — 2026-04-27

**Status:** PASS
**Pattern:** Add `validateWorkflowOutput` and `findUnresolvedPlaceholders` helpers in `engine.ts`; validate generated body/title immediately after writer output is stored, validate preflight output before skipping generation, and scan side-effect step objects for unresolved `{{key}}` tokens in the run loop before `executeStep(...)` is called.
**Gotcha:** The downstream placeholder gate must run on the resolved substituted step object, not the template — evaluate after `substituteStep(stepTemplate, runtimeParams)` fires so same-run outputs are visible, and fail before the approval gate and `executeStep` rather than inside `executeStep` so failures surface as clean run-loop breaks rather than buried step errors.
**Files:** `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `prd.json`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`

---

### [US-028] — Direct Workflow Gate Layer Phase 6: Reddit Duplicate-Check Deterministic Evidence Gate — 2026-04-27

**Status:** PASS
**Pattern:** Add `parseRedditDuplicateEvidence` helper in `engine.ts`; after `check_duplicate_reddit_post` succeeds, parse its output into structured evidence (extracted titles, overlap scores, result, matching title), validate score ranges, store parsed values in `outputs`, and emit `evidence_parsed`/`evidence_failed` telemetry; gate `submit_reddit_post` before `executeStep` by re-validating stored evidence, blocking on missing evidence, missing titles/scores, out-of-range scores, DUPLICATE_RISK, and score-result contradiction (score ≥ 0.70 + NO_DUPLICATE_FOUND).
**Gotcha:** DUPLICATE_RISK does not fail the run at parse time — it only blocks at the `submit_reddit_post` pre-execute gate; a workflow that stops before submit (e.g. a check-only workflow) will complete successfully even when the stored result is DUPLICATE_RISK, which is intentional and must not be confused with a missing gate.
**Files:** `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `workflows/post_to_reddit.yaml`, `workflows/write_and_post_to_reddit.yaml`, `prd.json`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`

---

### [US-029] — Direct Workflow Gate Layer Phase 7: Browser Side-Effect/Postcondition Gate — 2026-04-27

**Status:** PASS
**Pattern:** Add optional postcondition metadata to direct side-effect step schemas, then run a local `validateBrowserPostcondition` helper after `executeStep(...)` so direct workflows can prove expected URL and output evidence before downstream steps continue; apply a built-in default gate to `submit_reddit_post` requiring both `/comments/` URL state and Reddit comments URL output evidence.
**Gotcha:** The postcondition gate must evaluate after the side-effect step returns but before the normal `!result.success` branch finalizes the step, otherwise a false-success browser step will be recorded as successful and can still leak into downstream confirmation or extract steps.
**Files:** `src/workflow/types.ts`, `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `workflows/post_to_reddit.yaml`, `workflows/write_and_post_to_reddit.yaml`, `prd.json`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`

---

### [US-030] — Direct Workflow Gate Layer Phase 8: Generalized Precondition/Skip Gate — 2026-04-27

**Status:** PASS
**Pattern:** Add one deterministic `evaluatePreconditionGate` helper before approval and `executeStep(...)` in the direct run loop to classify pre-execution decisions (`run`, `skip`, `fail`, `hitl`) and lift login/auth skip, generate preflight skip/fail, and navigate target-match skip into a single traceable control point.
**Gotcha:** Once precondition logic is lifted into the run loop, duplicate skip logic inside `executeStep` must be removed; keeping both layers causes double-skip semantics and inconsistent telemetry/order guarantees around approval and downstream gates.
**Files:** `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `prd.json`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`

---

---

## H-031 — US-031 / RF-013: agent_task Side-Effect Safety Gate

**Date:** 2026-04-28
**Story:** US-031 / RF-013
**Status:** PASS
**Gate Layer Phase:** 9

### Summary

Implemented the `agent_task` side-effect safety boundary in the direct workflow engine. The implementation adds a deterministic prompt classifier (`classifyAgentTaskSideEffect`) and a safety gate inside `executeStep`'s `case 'agent_task':` branch that runs after the unresolved-placeholder check and before worker dispatch via `routeAgentTask`.

The classifier identifies nine intent kinds: `login`, `fill`, `submit`, `publish`, `final_click`, `post`, `external_mutation`, `read_only`, `unknown`. Protected intents (`login`, `fill`, `submit`, `publish`, `final_click`, `post`, `external_mutation`) trigger safety checks:

1. **Approval enforcement** — `login` and `fill` intents require `approvalGrantedForStep === true` (computed from run-loop approval gate state and passed to `executeStep`).
2. **Content evidence enforcement** — `post` and `publish` intents validate known content output keys (`reddit_post_text`, `post_text`, `post_body`, etc.) from merged runtime params; empty or TODO/placeholder values block dispatch.
3. **Reddit duplicate evidence enforcement** — prompts containing reddit/subreddit language with `submit`, `post`, or `final_click` intent require stored duplicate-check evidence (same validation as the run-loop gate, extended to cover non-canonical step ids).

Telemetry: `workflow.agent_task_side_effect.evaluated` always; `workflow.agent_task_side_effect.allowed` or `workflow.agent_task_side_effect.blocked` depending on outcome.

All existing US-026 through US-030 gates remain intact. `mode: agentic` routing and final HITL confirmation unchanged.

### Files Touched

- `src/workflow/engine.ts`
- `src/workflow/engine.test.ts`
- `prd.json`
- `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
- `progress.txt`

### Validation

- `pnpm run typecheck` → exit 0
- `pnpm test` → 11/11 suites, 128/128 tests passed

---

## H-032 — US-032 / RF-014: agent_task Dominant Intent Classification Fix

**Date:** 2026-04-28
**Story:** US-032 / RF-014
**Status:** PASS
**Gate Layer Phase:** 10

### Summary

Implemented dominant-intent resolution for `agent_task` prompt classification so mixed-intent prompts no longer use first-match behavior. The classifier now gathers all matched signals, then selects a deterministic dominant intent.

The ranking was updated so dominant workflow actions (`submit`, `publish`, `post`, `final_click`) are selected over fallback `fill` wording when both appear in the same prompt. Standalone `fill`, standalone `login`, and read-only behavior remain intact.

Classifier details now include:

- `matchedSignals`
- `dominantIntentSource`
- `selectedIntent`

Regression tests now load the exact live `workflows/post_to_reddit.yaml` `submit_reddit_post` prompt and verify dominant submit selection plus telemetry detail payloads. Safety gate behavior from US-031 remains active (approval for login/fill, posting content checks, Reddit duplicate evidence checks, browser postcondition checks).

### Files Touched

- `src/workflow/engine.ts`
- `src/workflow/engine.test.ts`
- `prd.json`
- `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
- `progress.txt`

### Validation

- `pnpm run typecheck` → exit 0
- `pnpm test` → 11/11 suites, 131/131 tests passed

---

## H-033 — US-033 / RF-015: Live Workflow Prompt Contract Regression Suite

**Date:** 2026-05-01
**Story:** US-033 / RF-015
**Status:** PASS
**Gate Layer Phase:** 11

### Summary

Implemented exact live workflow prompt contract coverage for the Reddit duplicate-check and submit `agent_task` steps.

`classifyAgentTaskSideEffect(...)` now recognizes the canonical `check_duplicate_reddit_post` step contract as evidence-producing read-only work using a narrow deterministic condition: the exact step id plus the structured duplicate-check output markers. This keeps the step executable before `reddit_duplicate_check_evidence` exists while preserving matched lexical signals in telemetry and recording why protected submit-like wording was suppressed for this specific evidence-producing path.

The live `submit_reddit_post` prompt remains protected as submit intent. Existing duplicate-evidence enforcement is unchanged: missing evidence still blocks submit, duplicate-risk evidence still blocks submit, and valid no-duplicate evidence still allows worker dispatch. Regression tests now load the exact live prompts from `workflows/post_to_reddit.yaml` instead of relying only on simplified fixtures.

### Files Touched

- `src/workflow/engine.ts`
- `src/workflow/engine.test.ts`
- `prd.json`
- `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
- `docs/debriefs/2026-04-26-hitl-gate-story-reference.md`
- `docs/history/forge_history.md`
- `docs/history/history_index.md`
- `progress.txt`

### Validation

- `npx jest src/workflow/engine.test.ts --runInBand` → 66/66 tests passed
- `pnpm run typecheck` → exit 0
- `pnpm test` → 11/11 suites, 133/133 tests passed

---
