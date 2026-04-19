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
- The workflow CLI hosts the HITL UI in the same process as execution; terminal-state UX depends on the UI receiving `complete`/`error` before the CLI exits.

## GOTCHAS — Read Before Writing Code
- Do not write workflow teardown logic directly in `src/workflow/engine.ts`; add it to `src/workflow/wrap-up.ts` and keep ETL centralized.
- Do not add new observability by sprinkling `console.log`; route it through telemetry and let the detector layer decide what becomes an alert.
- Do not let `agent_task` prompts carry DOB/SSN values; those belong in encrypted pre-flight storage and/or HITL-only browser interaction.
- A durable Chrome profile exists in `~/.ai-vision/profiles/default`; fallback startup must also use a persistent context or saved data silently disappears.
- `POST /api/acknowledge` currently mutates live session state for ETL pickup; if you change HITL QA semantics, update wrap-up persistence at the same time.
- `hitl_qa` is reserved for final-step confirmation, not general note capture; the `/api/acknowledge` notes endpoint must not drive the workflow phase.
- If HITL rejects a final step, preserve the reason in `SessionState` and SIC artifacts; otherwise the self-heal loop loses the operator’s key evidence.
- If the workflow UI starts reconnecting right after a successful run, inspect whether the CLI exited too quickly after terminal state rather than assuming browser-use crashed.

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

---
