# AGENTS.md — FORGE Institutional Memory
# Kirk Engineering Systems
# This file is read automatically by every Claude Code instance in the FORGE loop.
# Update after EVERY story. This is the ToM (Tier of Management) for this project.

---

## Project: ai-vision
**Last Updated:** 2026-04-19
**Status:** Active build

---

## Architecture Overview
`ai-vision` is a multi-engine browser automation platform with a shared Playwright/Chrome session, a HITL web control panel, workflow execution, SQLite-backed history, and file-based long-term memory under `~/.ai-vision/memory/`. The production-hardening path now uses tiered short-term memory (scratch pad + encrypted pre-flight), explicit workflow intent metadata for sensitive fields, runtime pre-flight/investigation phases, and ETL-based workflow wrap-up.

## Key Files & Their Purpose
| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point |
| `src/workflow/engine.ts` | Main workflow state machine and engine routing |
| `src/workflow/wrap-up.ts` | Exclusive workflow teardown ETL and persistence handoff |
| `src/telemetry/manager.ts` | Central telemetry event pipeline, redaction, and issue detection |
| `src/telemetry/types.ts` | Typed telemetry event and alert contract |
| `src/memory/short-term.ts` | Session memory, scratch pad, encrypted pre-flight storage |
| `src/memory/indexer.ts` | Correlation lookup for pre-flight/bespoke detection |
| `src/memory/metadata.ts` | Portal/task metadata store for workflow correlations |
| `src/session/hitl.ts` | Blocking HITL coordinator for takeover and secure input |
| `src/ui/server.ts` | HITL web UI and secure input/QA endpoints |
| `src/db/repository.ts` | SQLite persistence for CLI sessions and workflow ETL artifacts |
| `prd.json` | FORGE task list |
| `progress.txt` | Append-only agent learnings |

## Environment Variables Required
```bash
# Copy to .env — never commit .env
ALPACA_PAPER=true
ALPACA_API_KEY=
ALPACA_SECRET_KEY=
OLLAMA_BASE_URL=http://localhost:11434
DATABASE_PATH=./data/app.sqlite
AI_VISION_MEMORY_DIR=~/.ai-vision/memory
AI_VISION_PROFILE_DIR=~/.ai-vision/profiles/default
AI_VISION_CRYPTO_SECRET=
AI_VISION_UI_SHUTDOWN_GRACE_MS=1500
```

## Patterns This Codebase Uses
- Session teardown goes through `src/workflow/wrap-up.ts`; runtime workflow artifacts are persisted to SQLite and `~/.ai-vision/memory/`, not source files.
- Telemetry is centralized through `src/telemetry/manager.ts`; emit typed events there instead of adding ad hoc logs.
- Sensitive fields are gated by workflow schema metadata (`field` / `targets`) rather than prompt regex.
- Short-term memory can hold encrypted pre-flight values for session reuse, but prompt injection must stay redacted.
- HITL can be either generic takeover or secure PII entry; the phase in `src/session/types.ts` determines the UI path.
- Final irreversible actions can now use `human_takeover.mode = "confirm_completion"` so the agent performs the closing action and HITL only verifies the visible outcome.
- A rejected final confirmation must capture a structured reason and drive both an immediate improvement record and a wrap-up SIC trigger; plain failure text is not enough.
- Recurring authenticated workflows should use the generic `authVerification` contract on login gates and a final QA-notes pause before wrap-up so learned portal context is not lost.
- The workflow CLI hosts the HITL UI in the same process as execution; terminal-state UX depends on the UI receiving `complete`/`error` before the CLI exits.
- `browser-use` sequential agent tasks may invalidate the supplied `BrowserSession`; the bridge must detect stale or reset session objects and recreate them instead of assuming CDP reconnect alone is sufficient.

## GOTCHAS — Read Before Writing Code
- Do not write workflow teardown logic directly in `src/workflow/engine.ts`; add it to `src/workflow/wrap-up.ts` and keep ETL centralized.
- Do not add new observability by sprinkling `console.log`; route it through telemetry and let the detector layer decide what becomes an alert.
- Do not let `agent_task` prompts carry DOB/SSN values; those belong in encrypted pre-flight storage and/or HITL-only browser interaction.
- A durable Chrome profile exists in `~/.ai-vision/profiles/default`; fallback startup must also use a persistent context or saved data silently disappears.
- `POST /api/acknowledge` currently mutates live session state for ETL pickup; if you change HITL QA semantics, update wrap-up persistence at the same time.
- `hitl_qa` is reserved for final-step confirmation, not general note capture; the `/api/acknowledge` notes endpoint must not drive the workflow phase.
- If HITL rejects a final step, preserve the reason in `SessionState` and SIC artifacts; otherwise the self-heal loop loses the operator’s key evidence.
- Do not assume a recurring portal needs manual login every run; encode explicit `authVerification` signals or the agent will keep pausing unnecessarily.
- If the workflow UI starts reconnecting right after a successful run, inspect whether the CLI exited too quickly after terminal state rather than assuming browser-use crashed.
- If a second `browser-use` step fails after a first one succeeded, inspect whether the library reset its event bus/session object between tasks; reconnecting a stale object is not enough.

---

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

---
