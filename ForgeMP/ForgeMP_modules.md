# ForgeMP Modules

**Project:** ai-vision  
**Date:** 2026-04-23  
**Branch:** forge/v2-orchestrator

---

## Module Inventory

| Module | Path | Role |
|---|---|---|
| **forge.sh** | `ForgeMP/forge.sh` | Main runner — session lifecycle, agent loop, gates |
| **forge-memory.sh** | `ForgeMP/forge-memory.sh` | SQLite shell layer — sourced by forge.sh; all DB ops |
| **forge-memory.db** | `forge-memory.db` (gitignored) | Stateful SQLite DB; 7 tables; WAL mode |
| **forge-memory-client.ts** | `ForgeMP/forge-memory-client.ts` | TypeScript DB client for agents (entry/exit protocol) |
| **MEMORY_PROTOCOL.md** | `ForgeMP/MEMORY_PROTOCOL.md` | Governance law — DB schema rationale, mandatory obligations |
| **prompt.md** | `ForgeMP/prompt.md` | Universal Agent Preamble injected into every Claude invocation |
| **FORGE.md** | `FORGE.md` | Project conventions, governance law, DB protocol link |
| **AGENTS.md** | `AGENTS.md` | Institutional memory — patterns, gotchas, story history |
| **forge.gates.sh** | `forge.gates.sh` | Quality gate runner (`tsc --noEmit`, `npm test`) |
| **forge.gates.example.sh** | `ForgeMP/forge.gates.example.sh` | Gate template/reference |
| **prd.json** | `prd.json` | Story task list; `passes` booleans; branch name |
| **progress.txt** | `progress.txt` | Append-only human-readable build log |
| **.forge_last_branch** | `.forge_last_branch` | State file — tracks active branch to detect archive triggers |
| **forge-sic.ts** | `src/memory/forge-sic.ts` | Runtime SIC→FORGE bridge; reads/writes `context_store` in forge-memory.db |
| **migrate-sic-to-forge.ts** | `ForgeMP/migrate-sic-to-forge.ts` | One-time migration; merges file-based SIC improvements → forge DB |
| **wrap-up.ts** | `src/workflow/wrap-up.ts` | Workflow ETL teardown; calls `forgeSicStore.saveSicTrigger()` |
| **ci.yml** | `.github/workflows/ci.yml` | CI — same gates as forge.gates.sh; triggers on `forge/**` branches |

---

## SQLite DB Schema (`forge-memory.db`)

| Table | Purpose |
|---|---|
| `forge_sessions` | One row per `forge.sh` invocation; tracks branch, project, iteration budget |
| `agent_iterations` | One row per Claude Code instance; execution ledger with gate results |
| `agent_messages` | Inter-agent message bus (DISCOVERY, BLOCKER, HANDOFF, WARNING, STATUS, DECISION) |
| `context_store` | Persistent KV store — survives context windows; also stores SIC improvements from runtime |
| `discoveries` | Structured findings (PATTERN, GOTCHA, BLOCKER, DECISION, DEPENDENCY, CONVENTION) → feeds AGENTS.md |
| `story_state` | Extended story state: attempt count, last error, active blockers, context notes |
| `audit_log` | Immutable append-only record of every significant FORGE action |

---

## Architecture Diagram

```mermaid
flowchart TD
    %% ── Entry Point ─────────────────────────────────────
    CLI["CLI: pnpm run forge\nor bash scripts/forge/forge.sh"]
    PRD["prd.json\n(story list + passes flags)"]
    GATES_SH["forge.gates.sh\n(tsc + test runner)"]
    LAST_BRANCH[".forge_last_branch\n(branch state)"]
    ARCHIVE["archive/\n(prior-run snapshots)"]

    CLI --> FORGE_SH

    %% ── Core Runner ─────────────────────────────────────
    subgraph RUNNER ["ForgeMP/forge.sh  —  Main Loop"]
        FORGE_SH["forge.sh\n(session lifecycle\nstory picker\nClaude invoker\ngate runner)"]
        FORGE_SH -->|"sources"| MEM_SH
        FORGE_SH -->|"reads/writes"| PRD
        FORGE_SH -->|"reads/writes"| LAST_BRANCH
        FORGE_SH -->|"writes on branch change"| ARCHIVE
        FORGE_SH -->|"runs after each iteration"| GATES_SH
        FORGE_SH -->|"appends on story pass"| PROGRESS
        FORGE_SH -->|"git commit on story pass"| GIT["git\n(commit history)"]
    end

    %% ── Memory Shell Layer ───────────────────────────────
    subgraph MEM_LAYER ["ForgeMP/forge-memory.sh  —  Shell DB Layer"]
        MEM_SH["forge-memory.sh\n(memory_init, create_session\nstart/end_iteration\npost_message, set_context\naudit, archive)"]
    end

    MEM_SH -->|"all reads/writes"| DB

    %% ── SQLite DB ────────────────────────────────────────
    subgraph DB_LAYER ["forge-memory.db  —  SQLite WAL"]
        DB["forge-memory.db"]
        T1["forge_sessions\n(one per forge.sh run)"]
        T2["agent_iterations\n(one per Claude instance)"]
        T3["agent_messages\n(inter-agent message bus)"]
        T4["context_store\n(persistent KV for agents\nAND SIC store for runtime)"]
        T5["discoveries\n(structured findings → AGENTS.md)"]
        T6["story_state\n(attempt counts, blockers, notes)"]
        T7["audit_log\n(append-only action trail)"]
        DB --- T1 & T2 & T3 & T4 & T5 & T6 & T7
    end

    %% ── Agent Runtime (TypeScript) ───────────────────────
    subgraph AGENT ["Agent Instance  —  Claude Code (TypeScript)"]
        PROMPT["ForgeMP/prompt.md\n(Universal Agent Preamble\nFunction 0 protocol)"]
        MEM_CLIENT["forge-memory-client.ts\n(ForgeMemory class\nentry() / exit())"]
        PROTOCOL["MEMORY_PROTOCOL.md\n(governance / schema spec)"]
        AGENTS_MD["AGENTS.md\n(institutional memory\nstory history)"]
        FORGE_MD["FORGE.md\n(conventions + governance law)"]

        FORGE_SH -->|"injects context via stdin"| PROMPT
        PROMPT -->|"instructs agent to call"| MEM_CLIENT
        PROMPT -->|"instructs agent to read"| PROTOCOL
        PROMPT -->|"instructs agent to read"| AGENTS_MD
        PROMPT -->|"instructs agent to read"| FORGE_MD
        MEM_CLIENT -->|"reads/writes"| DB
        PROTOCOL -->|"governs"| DB
    end

    %% ── Runtime SIC Bridge ───────────────────────────────
    subgraph RUNTIME ["src/  —  Runtime (ai-vision application)"]
        WRAP_UP["src/workflow/wrap-up.ts\n(workflow ETL teardown)"]
        FORGE_SIC["src/memory/forge-sic.ts\n(ForgeSicMemoryStore)"]
        WRAP_UP -->|"saveSicTrigger()\nsaveImprovementStore()"| FORGE_SIC
        FORGE_SIC -->|"reads/writes context_store\nwrites discoveries"| DB
    end

    %% ── Migration Script ─────────────────────────────────
    MIGRATE["ForgeMP/migrate-sic-to-forge.ts\n(one-time migration:\nfile SIC → forge DB)"]
    MIGRATE -->|"merges improvements → context_store"| DB

    %% ── CI ───────────────────────────────────────────────
    CI[".github/workflows/ci.yml\n(triggers on forge/** branches\nruns same tsc + test gates)"]
    CI -->|"mirrors"| GATES_SH

    %% ── Outputs ──────────────────────────────────────────
    PROGRESS["progress.txt\n(human-readable log)"]
    STARTUP_REPORT["forge-startup-report.md\n(per-session context briefing\ngenerated by forge-memory.sh)"]
    MEM_SH -->|"generates"| STARTUP_REPORT
    STARTUP_REPORT -->|"read by agent"| PROMPT
```

---

## Data Flow Summary

Compatibility note:
- The canonical implementation lives under `ForgeMP/`.
- `scripts/forge/` contains compatibility entrypoints for older handoffs and docs.

### Build-time (Shell → DB → Claude → DB → Gates)

1. `forge.sh` starts → sources `forge-memory.sh` → initializes `forge-memory.db` schema (WAL mode, all 7 tables)
2. Memory layer writes a `forge_sessions` row and generates `forge-startup-report.md`
3. `forge.sh` picks the next failing story from `prd.json`, injects `prompt.md` + context into Claude via stdin
4. Claude calls `ForgeMemory.entry()` → reads `agent_messages`, `story_state`, `context_store` (Function 0 gate)
5. Claude implements the story → calls `ForgeMemory.exit()` → writes `discoveries`, `context_store`, closes `agent_iterations` row
6. `forge.sh` runs `forge.gates.sh` → if gates pass: marks story `passes: true` in `prd.json`, appends `progress.txt`, commits git

### Runtime (Application → Forge DB)

- `wrap-up.ts` calls `ForgeSicMemoryStore.saveSicTrigger()` after each workflow run
- `forge-sic.ts` writes to `context_store` and `discoveries` in `forge-memory.db`
- This bridges live workflow learnings (SIC triggers, improvement store) into the same DB that agents read during the next build session — closing the build/run feedback loop

### CI

- `.github/workflows/ci.yml` triggers on `forge/**` branches
- Runs the identical typecheck (`tsc --noEmit`) + test gates as `forge.gates.sh`
- Ensures the same quality bar is enforced in both local FORGE runs and remote CI

---

## Key Governance Rules

- `forge-memory.db` must exist and pass a health check before any agent runs (`forge.sh` enforces this)
- Every agent must call `mem.entry()` before writing code and `mem.exit()` after quality gates
- All inter-agent communication flows through `agent_messages`; no out-of-band state
- Runtime SIC writes target `context_store` in FORGE DB — not flat files or the app SQLite DB
- `AI_VISION_SIC_FORGE_STRICT=true` (default) causes `ForgeSicMemoryStore` to throw if the DB or `context_store` table is absent
- `forge-memory.db` is gitignored; `progress.txt` and `AGENTS.md` are the human-readable audit surfaces
