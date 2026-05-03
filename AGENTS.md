# AGENTS.md — FORGE Institutional Memory

Kirk Engineering Systems

This file is read automatically by every Agent Code instance in the FORGE loop.

Update governance rules here as needed. Story history entries belong in `/home/spoq/ai-vision/docs/history/forge_history.md` and `/home/spoq/ai-vision/docs/history/history_index.md`.

---

## Project: ai-vision

**Last Updated:** 2026-04-22
**Status:** Active build

---

## Architecture Overview

`ai-vision` is a multi-engine browser automation platform with a shared Playwright/Chrome session, a HITL web control panel, workflow execution, SQLite-backed history, and file-based long-term memory under `~/.ai-vision/memory/`. The production-hardening path now uses tiered short-term memory (scratch pad + encrypted pre-flight), explicit workflow intent metadata for sensitive fields, runtime pre-flight/investigation phases, and ETL-based workflow wrap-up.

## Key Files & Their Purpose

| File | Purpose |
| --- | --- |
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
| `docs/artifacts/` | Forge story package artifacts and governed story deliverables only |
| `docs/debriefs/` | Non-story debriefs, investigations, traces, reports, quick references, and architecture notes |

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
- Live `browser-use` progress should come from the library's native `register_new_step_callback` hook, routed through the Node bridge callback server so telemetry, HITL UI, and orchestrator state all observe the same per-step events.
- When `pnpm run typecheck` or `tsc --noEmit` fails on memory, compare the local Node runtime against the CI-pinned Node 24 baseline before treating the failure as a TypeScript graph regression.
- Shared runtime schemas must not leak as exported `z.infer` unions across broad subsystem boundaries; keep Zod local and export static interfaces or DTOs instead.
- MCP tool registration and similar SDK-heavy generic seams should be contained behind one local non-generic helper plus argument normalizers instead of repeating schema-plus-handler inference inline.
- For established repo patterns, execute the minimal coherent file changes directly instead of presenting option menus, trade-off loops, or recommendation-only responses.
- If a task is mostly specified, assume the smallest safe missing details and finish the implementation in one pass unless a real blocker remains.
- If a task changes the actual build architecture, runtime topology, ownership boundaries, execution flow, or screenshot/runtime contract, re-align `docs/architecture/as-built_execution_atlas.md` before closing the Forge workflow.
- **At the end of every completed story or task, deliver a Summary of Work.** The summary must cover: what changed, which files were touched, the acceptance criteria, and the final validation result (typecheck exit code + test suite counts). It must appear in the agent's closing response and be recorded in `progress.txt`.
- Keep `docs/artifacts/` reserved for Forge story package files and governed story deliverables. Save non-story debriefs, investigations, traces, reports, quick references, and architecture notes under `docs/debriefs/`.

## Forge Handoff Package — Mandatory For Engineering Build Work

Every engineering build handoff in this repo must include all four artifacts below:

1. A first-class Forge storyline that explicitly directs the agent to use the Forge build loop.
2. A compact YAML story card for any explicit tracing work, including graphs, Mermaid graphs, tracing layers, module connections, or module shapes.
3. An AI agent prompt with explicit instructions to follow the Forge system and the Forge build loop.
4. An explicit definition of done.

If any one of those artifacts is missing, the handoff is incomplete and must not be treated as ready for implementation.

Story package artifacts belong in `docs/artifacts/`. Non-story supporting material referenced by a story belongs in `docs/debriefs/`.

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
- If live browser-use updates disappear, inspect the Node-side callback receiver and `BROWSER_USE_CALLBACK_URL` propagation before changing orchestrator polling or UI push logic.
- A V8 heap crash that ends in `SIGABRT` is a Node self-abort, not proof of kernel OOM pressure; reserve the OS-layer diagnosis for `SIGKILL`, cgroup limits, or `dmesg` OOM-killer evidence.
- If `tsc --noEmit` starts heap-aborting after a contract refactor, inspect whether a runtime schema or generic-heavy SDK helper escaped its owning module before treating the problem as a raw memory ceiling.
- Do not end known-pattern implementation work with conversational action menus, deferred-offer phrasing, or recommendation menus unless the task is blocked by missing requirements or unavailable tools.

---

## Story History Location

FORGE story history is archived in:
- `/home/spoq/ai-vision/docs/history/forge_history.md` (full narrative records)
- `/home/spoq/ai-vision/docs/history/history_index.md` (library-card quick reference)

### History Archiving SOP (Mandatory)

- Do not append full story entries to `AGENTS.md`.
- After each completed story, append the full story entry to `/home/spoq/ai-vision/docs/history/forge_history.md`.
- In the same change, append a library card row to `/home/spoq/ai-vision/docs/history/history_index.md`.
- Keep `AGENTS.md` focused on active governance, patterns, and operating rules.

---
