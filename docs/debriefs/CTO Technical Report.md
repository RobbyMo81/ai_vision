<!-- markdownlint-disable MD013 -->

# CTO Technical Report — ai-vision

> Historical snapshot, not current runtime source of truth. This report predates `US-005`; Stagehand was removed because it caused dual-browser/session drift. Current runtime engines are `browser-use` and `skyvern`.

Date: April 18, 2026
Branch: forge/mvp-setup
Author: Engineering Assessment (Claude Code)

---

## Executive Summary

  ai-vision is an AI-driven browser automation platform that translates natural-language prompts into multi-step web actions. The system routes tasks through a multi-engine abstraction layer (three engines: browser-use, Stagehand, Skyvern),
  coordinates Human-in-the-Loop (HITL) pauses for interactive steps (login, CAPTCHA, form review), and exposes capabilities via both a CLI and a Model Context Protocol (MCP) server for Claude Code integration.
  
  The project is MVP-ready for its primary use case — automated form submission workflows — and has shipped its first real-world workflow (DOT aviation consumer complaint). It has good architectural bones but carries meaningful technical debt in
  test coverage, CI/CD, and error recovery.

---

## System Architecture

  ┌─────────────────────────────────────────────────────────┐
  │              CLI  /  MCP Server  /  Workflow Engine      │
  │       src/cli/index.ts   src/mcp/server.ts               │
  │              src/workflow/engine.ts                      │
  └────────────────────┬────────────────────────────────────┘
                       │ registry.getReady(engineId)
           ┌───────────┼───────────┐
           │           │           │
    BrowserUse     Stagehand    Skyvern
    (Python FastAPI (Playwright  (Python FastAPI
     port 8001)    native TS)    port 8002)
           │           │           │
           └───────────┼───────────┘
                       │
           ┌───────────v───────────┐
           │   SessionManager      │
           │  (Shared Playwright   │
           │   Browser + CDP)      │
           └───────────┬───────────┘
                       │
           ┌───────────v───────────┐
           │   Memory System       │
           │  Short-term + Long-   │
           │  term (SIC promotions)│
           └───────────────────────┘

### Component Summary

  ┌──────────────────┬──────────────────────────────┬───────────────────────────────────────────────────────────┐
  │    Component     │           Location           │                          Purpose                          │
  ├──────────────────┼──────────────────────────────┼───────────────────────────────────────────────────────────┤
  │ CLI              │ src/cli/index.ts             │ Commander-based entry point for all commands              │
  ├──────────────────┼──────────────────────────────┼───────────────────────────────────────────────────────────┤
  │ Workflow Engine  │ src/workflow/engine.ts       │ Stateful step orchestrator with memory integration        │
  ├──────────────────┼──────────────────────────────┼───────────────────────────────────────────────────────────┤
  │ Engine Registry  │ src/engines/registry.ts      │ Factory + lifecycle management for all three engines      │
  ├──────────────────┼──────────────────────────────┼───────────────────────────────────────────────────────────┤
  │ Python Bridge    │ src/engines/python-bridge.ts │ Subprocess spawn + HTTP relay for browser-use/skyvern     │
  ├──────────────────┼──────────────────────────────┼───────────────────────────────────────────────────────────┤
  │ Session Manager  │ src/session/manager.ts       │ Singleton Playwright browser with CDP exposure            │
  ├──────────────────┼──────────────────────────────┼───────────────────────────────────────────────────────────┤
  │ HITL Coordinator │ src/session/hitl.ts          │ Promise-based blocking for human intervention steps       │
  ├──────────────────┼──────────────────────────────┼───────────────────────────────────────────────────────────┤
  │ HITL UI          │ src/ui/server.ts             │ HTTP + WebSocket live control panel at localhost:3000     │
  ├──────────────────┼──────────────────────────────┼───────────────────────────────────────────────────────────┤
  │ Memory (Short)   │ src/memory/short-term.ts     │ Session-scoped step tracking; injected into agent prompts │
  ├──────────────────┼──────────────────────────────┼───────────────────────────────────────────────────────────┤
  │ Memory (Long)    │ src/memory/long-term.ts      │ Persistent stories + SIC improvement promotion            │
  ├──────────────────┼──────────────────────────────┼───────────────────────────────────────────────────────────┤
  │ MCP Server       │ src/mcp/server.ts            │ 9-tool stdio MCP server for Claude Code integration       │
  ├──────────────────┼──────────────────────────────┼───────────────────────────────────────────────────────────┤
  │ Database         │ src/db/repository.ts         │ SQLite session history via node:sqlite                    │
  └──────────────────┴──────────────────────────────┴───────────────────────────────────────────────────────────┘

---

## Technology Stack

  ┌────────────────────┬───────────────────────────────────────────────────┐
  │       Layer        │                    Technology                     │
  ├────────────────────┼───────────────────────────────────────────────────┤
  │ Primary language   │ TypeScript 5.4 (strict mode)                      │
  ├────────────────────┼───────────────────────────────────────────────────┤
  │ Python engines     │ Python 3.10+ with FastAPI + uvicorn               │
  ├────────────────────┼───────────────────────────────────────────────────┤
  │ Config GUI         │ Rust 2021 with ratatui TUI                        │
  ├────────────────────┼───────────────────────────────────────────────────┤
  │ Browser automation │ Playwright-core (shared session), browser-use SDK │
  ├────────────────────┼───────────────────────────────────────────────────┤
  │ LLM clients        │ Anthropic SDK, OpenAI SDK (via LangChain)         │
  ├────────────────────┼───────────────────────────────────────────────────┤
  │ Schema validation  │ Zod (workflow definitions + API inputs)           │
  ├────────────────────┼───────────────────────────────────────────────────┤
  │ Database           │ SQLite via Node.js built-in node:sqlite           │
  ├────────────────────┼───────────────────────────────────────────────────┤
  │ CLI framework      │ Commander                                         │
  ├────────────────────┼───────────────────────────────────────────────────┤
  │ MCP transport      │ stdio (Model Context Protocol SDK)                │
  ├────────────────────┼───────────────────────────────────────────────────┤
  │ HTTP client        │ Axios (30-minute timeout for long agent tasks)    │
  ├────────────────────┼───────────────────────────────────────────────────┤
  │ WebSocket          │ ws library (HITL UI push)                         │
  ├────────────────────┼───────────────────────────────────────────────────┤
  │ Build              │ tsc + asset copy scripts                          │
  ├────────────────────┼───────────────────────────────────────────────────┤
  │ Testing            │ Jest + ts-jest                                    │
  └────────────────────┴───────────────────────────────────────────────────┘

---

## Memory System (Novel Architecture)

  The most architecturally distinctive component is the dual-layer memory system, built to solve observed agent failure modes (dropdown re-selection loops, field re-attempts):

### Short-Term Memory

- Tracks confirmed field completions per workflow step
- Injected at the start of each agent task prompt as === SESSION MEMORY ===
- Agents emit structured MEMORY_UPDATE_START/END blocks; parsed by the engine
- Prevents agent confusion loops (the primary observed failure mode)

### Long-Term Memory

- Persistent in ~/.ai-vision/memory/
- Stories: Per-run Markdown + JSON narratives (summary, lessons, metrics)
- SIC Promotion: Improvements tracked by occurrence count; at threshold 10, auto-promoted to Standard Improvement Contribution (SIC) — their agentInstruction is prepended to every future agent task prompt system-wide
- Examples of seeded improvements: Salesforce dropdown interaction pattern, autocomplete city name vs. IATA code handling

---

## Built-In Workflows

  ┌───────────────────────┬───────────────────────────────────────────────────────────────────────────────┬────────────────┐
  │      Workflow ID      │                                  Description                                  │     Steps      │
  ├───────────────────────┼───────────────────────────────────────────────────────────────────────────────┼────────────────┤
  │ dot_complaint_as683   │ DOT aviation consumer complaint — 4-phase (contact, flight, details, uploads) │ 7 steps + HITL │
  ├───────────────────────┼───────────────────────────────────────────────────────────────────────────────┼────────────────┤
  │ Credit card dispute   │ Form automation for CC dispute filing                                         │ TBD            │
  ├───────────────────────┼───────────────────────────────────────────────────────────────────────────────┼────────────────┤
  │ Generic authenticated │ Reusable template with HITL for login                                         │ 3 steps        │
  └───────────────────────┴───────────────────────────────────────────────────────────────────────────────┴────────────────┘

  The DOT complaint workflow was the system's first real-world execution target. It decomposed a monolithic 30-step agent task into 4 focused 2-3 minute phases to avoid HTTP bridge timeouts.

---

## Code Health

### Volume

- ~3,800 lines of TypeScript source across 18 modules
- ~400 lines of Python (FastAPI bridge servers)
- ~300 lines of Rust (config TUI)

### Test Coverage

  ┌───────────────────┬──────────────────────────────────────────────────────────┐
  │     Category      │                          Status                          │
  ├───────────────────┼──────────────────────────────────────────────────────────┤
  │ Unit tests        │ Light — registry, error classes (~40 lines actual tests) │
  ├───────────────────┼──────────────────────────────────────────────────────────┤
  │ Integration tests │ Manual — documented in Application_Test.md (20+ cases)   │
  ├───────────────────┼──────────────────────────────────────────────────────────┤
  │ E2E tests         │ None                                                     │
  ├───────────────────┼──────────────────────────────────────────────────────────┤
  │ CI/CD             │ None configured                                          │
  └───────────────────┴──────────────────────────────────────────────────────────┘

### Build Quality
  
- TypeScript strict mode enabled with zero type errors at last verified build
- tsc --noEmit typecheck passes clean
- Python bridge asset copy handled post-compile via npm run copy-assets

### Documentation Quality

- README.md — user quick-start and architecture overview
- PRD.md + prd.json — product requirements
- FORGE.md — development conventions and VPS deployment standards
- Application_Test.md — 20+ test case audit with pass/fail tracking
- Application_Fixes.md — 14 logged fixes (FIX-01 through FIX-14) with before/after code
- LLM_MODEL_IMPACT.md — cross-reference of all LLM config touch points

---

## Strengths

  1. Clean engine abstraction — Unified AutomationEngine interface means new engines are addable without touching workflow logic
  2. Shared browser session — All engines attach to the same Playwright CDP instance; HITL and automation share state seamlessly
  3. HITL as first-class primitive — Human handoff is a workflow step type, not an afterthought; works reliably via Promise blocking
  4. Memory-enhanced agent prompts — SIC injection + session context significantly reduces agent confusion across multi-step tasks
  5. MCP integration — 9-tool MCP server enables Claude Code to drive browser automation directly
  6. Real-world tested — System was exercised against a live Salesforce Experience Cloud form with multi-phase complex inputs

---

## Risk Areas

  ┌──────────────────────────────────────┬──────────┬───────────────────────────────────────────────────────────────┐
  │                 Risk                 │ Severity │                             Notes                             │
  ├──────────────────────────────────────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ No automated tests beyond unit stubs │ High     │ Manual test reliance does not scale                           │
  ├──────────────────────────────────────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ No CI/CD pipeline                    │ High     │ No automated build verification on commits                    │
  ├──────────────────────────────────────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ Python bridge subprocess per engine  │ Medium   │ No pooling; spawns new process per initialization             │
  ├──────────────────────────────────────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ Bridge timeout reliance              │ Medium   │ Increased to 30 min; long tasks need decomposition discipline │
  ├──────────────────────────────────────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ Memory MEMORY_UPDATE reliance        │ Medium   │ Falls back gracefully but loses field-level fidelity          │
  ├──────────────────────────────────────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ Hardcoded port assignments           │ Low      │ Fails if another process occupies 8001/8002                   │
  ├──────────────────────────────────────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ No retry/backoff logic               │ Medium   │ Any transient network error fails the workflow                │
  ├──────────────────────────────────────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ Inline HTML in UI server             │ Low      │ Not maintainable at scale; technical debt                     │
  └──────────────────────────────────────┴──────────┴───────────────────────────────────────────────────────────────┘

---

## Technical Debt Inventory

  ┌────────────────────────────────────────────────────┬─────────────────┬──────────┐
  │                        Item                        │    Category     │ Priority │
  ├────────────────────────────────────────────────────┼─────────────────┼──────────┤
  │ Write integration tests for workflow phases        │ Testing         │ P0       │
  ├────────────────────────────────────────────────────┼─────────────────┼──────────┤
  │ Configure GitHub Actions for build + typecheck     │ CI/CD           │ P0       │
  ├────────────────────────────────────────────────────┼─────────────────┼──────────┤
  │ Add retry logic for Python bridge HTTP calls       │ Reliability     │ P1       │
  ├────────────────────────────────────────────────────┼─────────────────┼──────────┤
  │ Replace inline UI HTML with proper frontend        │ Maintainability │ P2       │
  ├────────────────────────────────────────────────────┼─────────────────┼──────────┤
  │ Pin Python dependency versions in requirements.txt │ Stability       │ P1       │
  ├────────────────────────────────────────────────────┼─────────────────┼──────────┤
  │ Abstract port management into discovery service    │ Scalability     │ P2       │
  ├────────────────────────────────────────────────────┼─────────────────┼──────────┤
  │ Add telemetry/structured logging per engine        │ Observability   │ P2       │
  └────────────────────────────────────────────────────┴─────────────────┴──────────┘

---

## Deployment Readiness

  ┌─────────────────────────────┬────────────────────────────────────────────────────────────┐
  │           Target            │                           Status                           │
  ├─────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ Local development           │ Ready                                                      │
  ├─────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ VPS (single instance)       │ Ready with manual systemd setup per FORGE.md               │
  ├─────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ Claude Code MCP integration │ Ready — stdio server built and tested                      │
  ├─────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ Multi-tenant / distributed  │ Not ready — SessionManager is a singleton; no queue system │
  ├─────────────────────────────┼────────────────────────────────────────────────────────────┤
  │ Production-hardened         │ Not ready — no CI, no retry, no observability              │
  └─────────────────────────────┴────────────────────────────────────────────────────────────┘

---

## Recommended Next Steps (Prioritized)

  1. Add GitHub Actions — npm run typecheck && npm test on every push to main and forge/*
  2. Write workflow integration tests — Headless smoke tests against mock DOT form or equivalent test site
  3. Retry logic in python-bridge.ts — Exponential backoff for transient HTTP failures (3 retries, max 10s)
  4. Pin Python requirements — Change >= to == for production stability
  5. Merge memory system to main — src/memory/ is untracked; needs to be committed with the engine changes
  6. Commit current working state — Several modified files (engine.ts, python-bridge.ts, types.ts) and all of src/memory/ are uncommitted

---

## Summary Verdict

  ai-vision is a well-architected PoC with real-world validation. The multi-engine abstraction, shared browser session, HITL primitive, and dual-layer memory system are genuinely novel and solve real problems. The first production workflow shipped
  successfully. The core risk is a nearly complete absence of automated testing and CI — the system works today because the team tested it manually and documented carefully, but that doesn't scale. The most important near-term investment is
  hardening the test and deployment infrastructure around what is already a solid technical foundation.
