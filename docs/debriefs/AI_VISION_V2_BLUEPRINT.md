# AI-VISION v2 — Architecture Blueprint
## Single Source of Truth · Build Handoff Document
**Status:** ACTIVE BLUEPRINT — do not modify without updating the task checklist  
**Branch target:** `forge/v2-orchestrator`  
**Last updated:** 2026-04-20

---

## AGENT: READ THIS FIRST — FORGE Build Protocol

Before writing a single line of code you MUST complete the FORGE entry gate:

```
1. Read scripts/forge/prompt.md in full (Universal Agent Preamble)
2. Run: npx ts-node scripts/forge/forge-memory-client.ts messages
3. Run: npx ts-node scripts/forge/forge-memory-client.ts context
4. Check prd.json for current story state
5. Register your session in forge-memory.db (agent_iterations table)
```

**Build cycle — enforce strictly, no exceptions:**

```
┌─────────────────────────────────────────────────────┐
│  READ task from this document                       │
│         ↓                                           │
│  PERFORM the task (one task at a time)              │
│         ↓                                           │
│  REVIEW: re-read the task definition                │
│         ↓                                           │
│  DETERMINE: is the task fully complete?             │
│    → NO  → fix delta, repeat PERFORM               │
│    → YES → mark [x] in this document               │
│         ↓                                           │
│  LOOP to next unchecked task                        │
│         ↓                                           │
│  END when all tasks in a story are [x]              │
│  → post STATUS message to forge-memory.db           │
│  → record GOTCHA discoveries                        │
│  → update story_state to passes: true               │
└─────────────────────────────────────────────────────┘
```

**Quality gate — must pass before marking any task [x]:**
```bash
npx tsc --noEmit          # zero errors
npm test                  # all tests pass
npm run build             # clean build
```

---

## Why This Redesign Exists

The current system is an RPA framework with LLM calls inserted at each step. Intelligence is constrained to micro-tasks ("fill this form", "check this pattern"). The model's reasoning is wasted on step sequencing instead of the actual goal.

**The shift:** Claude owns the reasoning loop. Gemini owns the writing. ChatGPT/browser-use owns browser execution. The system provides reliable infrastructure — browser access, memory, HITL gates, telemetry — not rigid step chains.

---

## Current Architecture — Full Layer Map

```
┌─────────────────────────────────────────────────────────────────────┐
│  ENTRY POINTS                                                        │
│  cli/index.ts ──────── workflow / serve / run / history / config    │
│  mcp/server.ts ─────── Claude Code tool integration (stdio)         │
│  src/index.ts ──────── NPM library exports                          │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│  ORCHESTRATION  (workflow/engine.ts — THE MONOLITH)                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │ Step Router │  │ HITL Gates   │  │ Content Bootstrap          │ │
│  │ switch/case │  │ (fixed pts)  │  │ (Gemini hardwired)         │ │
│  └─────────────┘  └──────────────┘  └────────────────────────────┘ │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │ SIC Prompt  │  │ Social       │  │ Wrap-up ETL                │ │
│  │ Injection   │  │ Outcome Cls. │  │ wrap-up.ts                 │ │
│  └─────────────┘  └──────────────┘  └────────────────────────────┘ │
│  WORKFLOW DEFINITIONS: workflow/types.ts (hardcoded TypeScript)     │
└──────┬────────────────┬──────────────────┬──────────────────────────┘
       │                │                  │
┌──────▼──────┐  ┌──────▼───────┐  ┌──────▼──────────────────────────┐
│  ENGINE     │  │  SESSION     │  │  MEMORY (8 singletons)          │
│  registry   │  │  manager.ts  │  │  short-term.ts  step context    │
│  stagehand  │  │  (Chrome CDP)│  │  long-term.ts   SIC + stories   │
│  browser-use│  │  hitl.ts     │  │  indexer.ts     correlations    │
│  skyvern    │  │  types.ts    │  │  metadata.ts    domain tracking │
│  py-bridge  │  │              │  │  forge-sic.ts   FORGE bridge    │
└──────┬──────┘  └──────┬───────┘  └──────────────────┬──────────────┘
       │                │                              │
┌──────▼────────────────▼──────────────────────────────▼─────────────┐
│  INFRASTRUCTURE                                                      │
│  ui/server.ts    HITL control panel (HTTP + WebSocket)             │
│  telemetry/      event log, issue detection, SQLite persist         │
│  db/repository   SQLite (ai-vision.db)                             │
│  content/gemini  Gemini API client (write posts)                   │
│  utils/crypto    AES-256-GCM PII encryption                        │
└─────────────────────────────────────────────────────────────────────┘

FORGE (scripts/forge/) — parallel system, shares forge-memory.db
  forge.sh · prompt.md · forge-memory-client.ts · prd.json
```

### Module Interaction Matrix

```
                    engine  session  memory  hitl  telemetry  db  gemini
cli/index.ts          ✓       ✓               ✓       ✓        ✓
workflow/engine.ts    ✓       ✓       ✓       ✓       ✓            ✓
workflow/wrap-up.ts                   ✓               ✓        ✓
mcp/server.ts         ✓       ✓               ✓       ✓
ui/server.ts                  ✓               ✓       ✓        ✓
py-bridge (Python)    —       — (CDP via env)  —      —         —
```

---

## What Stays vs What Changes

```
✅  KEEP — solid infrastructure            ❌  REPLACE — rigid scaffolding
────────────────────────────────────────────────────────────────────────
session/manager.ts  (Chrome CDP)          workflow/types.ts (hardcoded steps)
telemetry/ (event bus + SQLite)           workflow/engine.ts switch/case router
db/repository.ts (persistence)            Fixed HITL gate positions
hitl.ts (event coordination)              SIC injection (band-aid learning)
ui/server.ts (control panel)              outputFailsOn regex matching
memory/ (structure is right)              Stagehand engine (dual-browser bug)
py-bridge.ts (subprocess mgmt)            8-singleton initialization chain
mcp/server.ts (KEY: Claude bridge)        Gemini hardwired to bootstrap only
```

### The MCP Bridge Already Exists

`mcp/server.ts` already exposes `browser_navigate`, `browser_run_task`, `workflow_run`,
`session_status` as Claude tools. The path to Claude-as-orchestrator is already built.
What is missing is the tooling layer Claude needs to reason and act autonomously.

---

## Target Architecture — v2

```
┌─────────────────────────────────────────────────────────────────────┐
│  DEFINITION LAYER  (new — replaces workflow/types.ts)               │
│  workflows/*.yaml      goal, tools, permissions, constraints        │
│  instructions/*.md     per-model persona + decision rules           │
│    orchestrator.md     Claude system prompt + tool usage rules      │
│    author.md           Gemini voice, tone, platform style           │
│    executor.md         ChatGPT browser execution constraints        │
└────────────────────────────┬────────────────────────────────────────┘
                             │ reads at runtime
┌────────────────────────────▼────────────────────────────────────────┐
│  CLAUDE ORCHESTRATOR  (replaces WorkflowEngine switch/case)         │
│                                                                      │
│  Reads: YAML goal + md instructions + memory snapshot + telemetry  │
│  Decides: which tool to call, when to ask human, when to stop      │
│                                                                      │
│  Tool calls (MCP):                                                  │
│  write_copy(topic, platform, tone)  →  Gemini API                  │
│  browser_task(instruction)          →  ChatGPT → browser-use       │
│  request_approval(reason, preview)  →  HITL coordinator            │
│  read_memory(key)                   →  memory bank                 │
│  write_memory(key, value)           →  memory bank                 │
│  query_telemetry(filter)            →  telemetry DB                │
└──────────────┬──────────────────────────────────────────────────────┘
               │
   ┌───────────┼───────────────────┐
   ▼           ▼                   ▼
Gemini      ChatGPT            HITL Gate
(author)    (workhorse)        (ui/server)
   │        browser-use           │
   │        py-bridge             │
   │        shared Chrome (CDP)   │
   └───────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────────────┐
│  UNCHANGED INFRASTRUCTURE                                            │
│  session/manager.ts · hitl.ts · telemetry/ · db/ · memory/         │
└─────────────────────────────────────────────────────────────────────┘
```

### Three-Model Role Contract

| Model | Role | Invoked by | For |
|---|---|---|---|
| Claude (Sonnet/Opus) | Orchestrator | YAML goal trigger | Planning, reasoning, HITL judgment, tool sequencing |
| Gemini (2.5 Flash) | Author | Claude tool call `write_copy` | All user-facing copy — posts, titles, captions |
| ChatGPT (GPT-4o) | Workhorse | Claude tool call `browser_task` | Browser navigation, form filling, extraction |

### New File Structure

```
src/
  orchestrator/
    loader.ts          # reads workflows/*.yaml + instructions/*.md
    loop.ts            # Claude tool-calling agent loop
    tools.ts           # MCP tool definitions for Claude
  mcp/
    server.ts          # EXTENDED with new tools (write_copy, query_telemetry, etc.)

workflows/             # NEW — replaces workflow/types.ts hardcoded definitions
  post_to_reddit.yaml
  post_to_x.yaml
  authenticated_task.yaml
  write_and_post_to_reddit.yaml

instructions/          # NEW — replaces SIC prompt injection
  orchestrator.md      # Claude persona + decision rules
  author.md            # Gemini voice/tone/platform guidelines
  executor.md          # ChatGPT browser task constraints

memory/
  world.md             # persistent facts (platform quirks, auth state)
  user_preferences.md  # tone, posting cadence, review thresholds
  platform_knowledge/
    reddit.md          # subreddit rules, timing, format knowledge
    x.md               # character limits, thread patterns

docs/debriefs/
  AI_VISION_V2_BLUEPRINT.md   # THIS FILE — single source of truth
```

---

## YAML Workflow Schema (target format)

```yaml
# workflows/write_and_post_to_reddit.yaml
id: write_and_post_to_reddit
name: Write and Post to Reddit
description: Draft a Reddit post with Gemini and publish with human approval

params:
  topic:
    type: string
    required: true
  subreddit:
    type: string
    default: test
  tone:
    type: enum
    values: [conversational, professional, direct, factual]
    default: conversational

permissions:
  require_human_approval_before:
    - post_submit          # irreversible — always gate
  allow_autonomous:
    - content_generation
    - duplicate_check
    - form_fill

tools_available:
  - write_copy
  - browser_task
  - request_approval
  - read_memory
  - write_memory
  - query_telemetry

constraints:
  max_browser_tasks: 5
  duplicate_check: required
  platform: reddit
```

---

## Markdown Instruction Format (target format)

```markdown
<!-- instructions/orchestrator.md -->
# Claude Orchestrator — Decision Rules

You are the orchestrator for ai-vision. You receive a workflow goal and
decide the sequence of tool calls to complete it safely.

## Principles
- Never submit, post, or send anything without calling request_approval first
- Call write_copy for ALL user-facing text — do not write copy yourself
- Call browser_task for ALL browser interactions — do not navigate yourself
- Read memory before starting any workflow to check prior context
- Write memory after any significant state change

## When to call request_approval
- Before any irreversible action (post, submit, send, delete)
- When confidence is below 80% that the task succeeded
- When telemetry shows an error in the last 3 steps

## When to stop and report failure
- After 3 consecutive browser_task failures on the same goal
- If authentication is lost and cannot be recovered
- If duplicate content is detected and user has not explicitly approved
```

---

## Central Memory Bank Design

The existing `memory/` module structure is kept. Three additions:

```
memory/
  bank/                  # NEW — persistent world knowledge
    world.md             # platform quirks, auth patterns, known errors
    user_preferences.md  # user's tone, review habits, posting rules
    platform/
      reddit.md          # subreddit norms, rate limits, form quirks
      x.md               # char limits, threads, media rules

  short-term.ts          # KEEP — step context within a run
  long-term.ts           # KEEP — SIC and stories across runs
  bank-reader.ts         # NEW — reads markdown files into Claude context
```

Claude reads the relevant bank files at the start of each orchestration session.
This replaces the SIC injection band-aid with structured, human-readable context.

---

## New MCP Tools Required

Add to `mcp/server.ts`:

| Tool | Input | Output | Calls |
|---|---|---|---|
| `write_copy` | topic, platform, tone, context | title + body text | Gemini API |
| `query_telemetry` | event_name?, step_id?, limit | recent events JSON | db/repository |
| `read_memory` | key (file path in memory/bank/) | markdown content | fs.readFile |
| `write_memory` | key, content | success | fs.writeFile |
| `list_workflows` | — | available YAML workflows | workflows/*.yaml |

---

## Stagehand Removal

`StagehandEngine` (`src/engines/stagehand/engine.ts`) is removed.

**Why:** Stagehand launches its own Playwright Chromium, causing a dual-browser drift
problem where the HITL panel shows one browser and the agent works in another.
All steps that were `engine: 'stagehand'` are already migrated to `engine: 'browser-use'`.

**Action:** Delete `src/engines/stagehand/` and remove from registry and index exports.

---

## Build Stories for prd.json

Add the following to `prd.json` when ready to begin the FORGE build loop:

```json
[
  {
    "id": "US-005",
    "title": "Remove Stagehand engine and clean registry",
    "passes": false,
    "acceptance": [
      "src/engines/stagehand/ deleted",
      "registry.ts has no stagehand reference",
      "src/index.ts has no stagehand export",
      "npx tsc --noEmit passes",
      "npm test passes"
    ]
  },
  {
    "id": "US-006",
    "title": "YAML workflow loader",
    "passes": false,
    "acceptance": [
      "workflows/*.yaml directory exists with at least post_to_reddit.yaml",
      "src/orchestrator/loader.ts loads and validates YAML against zod schema",
      "CLI workflow command accepts a .yaml file path in addition to built-in names",
      "npx tsc --noEmit passes"
    ]
  },
  {
    "id": "US-007",
    "title": "Markdown instruction loader",
    "passes": false,
    "acceptance": [
      "instructions/orchestrator.md exists",
      "instructions/author.md exists",
      "instructions/executor.md exists",
      "src/orchestrator/loader.ts reads and returns instruction markdown",
      "Content is injected into Claude context at session start"
    ]
  },
  {
    "id": "US-008",
    "title": "New MCP tools: write_copy, query_telemetry, read_memory, write_memory",
    "passes": false,
    "acceptance": [
      "mcp/server.ts exposes write_copy tool calling GeminiWriter",
      "mcp/server.ts exposes query_telemetry tool reading telemetry DB",
      "mcp/server.ts exposes read_memory and write_memory tools",
      "All tools have zod-validated input schemas",
      "npx tsc --noEmit passes"
    ]
  },
  {
    "id": "US-009",
    "title": "Claude orchestrator loop",
    "passes": false,
    "acceptance": [
      "src/orchestrator/loop.ts implements Claude tool-calling agent loop",
      "Loop reads YAML workflow + md instructions before first tool call",
      "Loop reads memory bank context before first tool call",
      "Loop enforces permissions.require_human_approval_before from YAML",
      "workflowEngine.run() delegates to orchestrator loop when YAML source",
      "End-to-end: `workflow write_and_post_to_reddit` completes via Claude loop",
      "npx tsc --noEmit passes",
      "npm test passes"
    ]
  },
  {
    "id": "US-010",
    "title": "Memory bank seeding",
    "passes": false,
    "acceptance": [
      "memory/bank/ directory created",
      "memory/bank/world.md seeded with known platform quirks from session history",
      "memory/bank/platform/reddit.md seeded with r/test and r/artificial observations",
      "memory/bank/user_preferences.md created with defaults",
      "bank-reader.ts reads and formats bank files for Claude context injection"
    ]
  },
  {
    "id": "US-012",
    "title": "browser-use live event bridge",
    "passes": false,
    "acceptance": [
      "browser-use Python server POSTs action events to BROWSER_USE_CALLBACK_URL",
      "Node.js python-bridge receives and emits telemetry for each browser-use action",
      "UI WebSocket forwards browser_use.action.* events to client in real-time",
      "Orchestrator loop receives mid-task browser state without polling",
      "npx tsc --noEmit passes",
      "npm test passes"
    ]
  },
  {
    "id": "US-011",
    "title": "Webhooks — inbound triggers and outbound notifications",
    "passes": false,
    "acceptance": [
      "src/webhooks/server.ts exposes POST /webhooks/trigger accepting {workflow_id, params}",
      "Inbound request validates signature (WEBHOOK_SECRET) before executing workflow",
      "Workflow result POSTed to configured callback_url if provided in trigger payload",
      "Outbound POST includes {workflow_id, success, outputs, durationMs, timestamp}",
      "webhook_secret stored via vault:export, never in plaintext env",
      "src/webhooks/server.ts registers with Express/Fastify app on AI_VISION_WEBHOOK_PORT",
      "npx tsc --noEmit passes",
      "npm test passes"
    ]
  }
]
```

---

## Implementation Task Checklist

Agent: work through these in order. One task at a time. Check off [x] only after quality gate passes.

### Story US-005 — Remove Stagehand

- [x] Delete `src/engines/stagehand/` directory entirely
- [x] Remove `StagehandEngine` from `src/engines/registry.ts`
- [x] Remove `StagehandEngine` from `src/index.ts` exports
- [x] Search for any remaining `stagehand` references in `src/` and remove
- [x] Run quality gate: `npx tsc --noEmit && npm test && npm run build`
- [x] Update `prd.json` US-005 `passes: true`
- [x] Post STATUS to forge-memory.db

### Story US-006 — YAML Workflow Loader

- [x] Create `workflows/` directory at project root
- [x] Define zod schema for YAML workflow in `src/orchestrator/loader.ts`
- [x] Write `post_to_reddit.yaml` using the schema defined in this document
- [x] Write `write_and_post_to_reddit.yaml`
- [x] Write `post_to_x.yaml`
- [x] Write `authenticated_task.yaml`
- [x] Add `js-yaml` or `yaml` npm package for parsing
- [x] Export `loadWorkflow(path: string): WorkflowDefinition` from loader.ts
- [x] Update CLI `workflow` command to accept `.yaml` file paths
- [x] Run quality gate
- [x] Update `prd.json` US-006 `passes: true`
- [x] Post STATUS to forge-memory.db

### Story US-007 — Markdown Instruction Loader

- [x] Create `instructions/` directory at project root
- [x] Write `instructions/orchestrator.md` with Claude decision rules
- [x] Write `instructions/author.md` with Gemini voice/tone guidelines
- [x] Write `instructions/executor.md` with ChatGPT browser constraints
- [x] Add `loadInstructions(role: string): string` to `src/orchestrator/loader.ts`
- [x] Run quality gate
- [x] Update `prd.json` US-007 `passes: true`
- [x] Post STATUS to forge-memory.db

### Story US-008 — New MCP Tools

- [x] Add `write_copy` tool to `mcp/server.ts` (calls GeminiWriter)
- [x] Add `query_telemetry` tool to `mcp/server.ts` (reads db/repository)
- [x] Add `read_memory` tool to `mcp/server.ts` (reads memory/bank/ files)
- [x] Add `write_memory` tool to `mcp/server.ts` (writes memory/bank/ files)
- [x] Add `list_workflows` tool to `mcp/server.ts` (lists workflows/*.yaml)
- [x] All inputs validated with zod schemas
- [x] Run quality gate
- [x] Update `prd.json` US-008 `passes: true`
- [x] Post STATUS to forge-memory.db

### Story US-009 — Claude Orchestrator Loop

- [x] Create `src/orchestrator/loop.ts`
- [x] Implement Claude Anthropic API tool-calling loop (streaming preferred)
- [x] Loop init: load YAML + md instructions + memory bank snapshot
- [x] Loop enforces `permissions.require_human_approval_before` from YAML
- [x] Loop writes telemetry events for each tool call
- [x] Loop writes memory after key state changes
- [x] Update `workflowEngine.run()` to route YAML-sourced workflows to loop
- [x] End-to-end test: `write_and_post_to_reddit` via Claude loop
- [x] Run quality gate
- [x] Update `prd.json` US-009 `passes: true`
- [x] Post STATUS to forge-memory.db

### Story US-010 — Memory Bank Seeding

- [x] Create `memory/bank/` directory
- [x] Create `memory/bank/world.md`
- [x] Create `memory/bank/user_preferences.md`
- [x] Create `memory/bank/platform/reddit.md` with known quirks from test runs
- [x] Create `memory/bank/platform/x.md`
- [x] Create `src/memory/bank-reader.ts`
- [x] Integrate bank-reader into orchestrator loop init
- [x] Run quality gate
- [x] Update `prd.json` US-010 `passes: true`
- [x] Post STATUS to forge-memory.db

### Story US-012 — browser-use Live Event Bridge

- [ ] Add `POST /events` endpoint to `src/engines/browser-use/server/main.py` — browser-use agent pushes action events here
- [ ] Define event schema: `{session_id, step_id, action, selector?, url, screenshot_b64?, timestamp}`
- [ ] Node.js bridge (`python-bridge.ts`) exposes `onBrowserEvent(cb)` — receives forwarded events
- [ ] Each browser-use event emitted as telemetry `browser_use.action.*` on Node.js side
- [ ] UI WebSocket forwards `browser_use.action.*` events to client in real-time
- [ ] Orchestrator loop subscribes to events so Claude sees mid-task state without polling
- [ ] Add `BROWSER_USE_CALLBACK_URL` env var — set automatically by python-bridge on startup
- [ ] Run quality gate
- [ ] Update `prd.json` US-012 `passes: true`
- [ ] Post STATUS to forge-memory.db

### Story US-011 — Webhooks

- [x] Create `src/webhooks/server.ts`
- [x] Add `POST /webhooks/trigger` route: accepts `{workflow_id, params, callback_url?}`
- [x] Validate HMAC-SHA256 signature against `WEBHOOK_SECRET` before executing
- [x] On receipt: call `workflowEngine.run()` with parsed params
- [x] On completion: if `callback_url` present, POST `{workflow_id, success, outputs, durationMs, timestamp}`
- [x] Retry outbound POST up to 3 times with exponential backoff on non-2xx
- [x] Add `AI_VISION_WEBHOOK_PORT` env var (default: 3001)
- [x] Add `WEBHOOK_SECRET` to vault — reference `vault:export` in env reference section
- [x] Register webhook server in `src/cli/index.ts` alongside UI server
- [x] Run quality gate
- [x] Update `prd.json` US-011 `passes: true`
- [x] Post STATUS to forge-memory.db

---

## Known Gotchas — Do Not Repeat

These issues were discovered during the v1 test runs and must be avoided in v2:

| # | Gotcha | Fix Applied |
|---|---|---|
| G-01 | Stagehand launches own Chrome — HITL panel shows wrong browser | Remove Stagehand entirely |
| G-02 | Chrome orphaned on pkill, port 9223 held by zombie | fuser -k + SIGTERM handler in session/manager.ts |
| G-03 | browser-use races Chrome restart (11ms window) | CDP ready-poll in Python bridge `_create_session()` |
| G-04 | SessionManager `_page` stale after agent opens new tab | `syncActivePage()` called after every browser-use task |
| G-05 | `outputFailsOn` triggered by agent echoing prompt | Check last non-empty line only |
| G-06 | browser-use port 8001 held by orphan from previous run | Port-reuse / adopt-existing logic in `python-bridge.ts` |
| G-07 | HITL "Continue Wrap-up" label misleads — same button two contexts | Distinct `hitlAction` types: `approve_draft` vs `capture_notes` |
| G-08 | Wrap-up HITL gate appears on success — confuses "done" signal | Gate now appears ONLY on failure |
| G-09 | r/test duplicate check bypassed — multiple posts accumulate | Bypass removed; check always runs including user's own posts |
| G-10 | Reddit form cleared between draft and submit HITL handoff | Submit step self-heals: re-fills if fields empty |

---

## Environment Variables Reference

```bash
# Models
ANTHROPIC_API_KEY=          # Claude orchestrator
OPENAI_API_KEY=             # ChatGPT workhorse (browser-use LLM)
GEMINI_API_KEY=             # Gemini author
GEMINI_MODEL=               # default: gemini-2.5-flash

# Browser
AI_VISION_HEADED=true       # show browser window
AI_VISION_CDP_PORT=9223     # Chrome remote debug port
AI_VISION_PROFILE_DIR=      # Chrome profile (cookies persist here)
BROWSER_CDP_URL=            # set automatically by SessionManager
BROWSER_USE_PORT=8001       # browser-use bridge port

# Application
AI_VISION_UI_PORT=3000      # HITL control panel
DB_PATH=./ai-vision.db      # SQLite main DB
FORGE_MEMORY_DB_PATH=./forge-memory.db  # FORGE working memory
SESSION_DIR=./sessions      # screenshot output
```

---

## Success Definition for v2

The build is complete when:

1. `workflow write_and_post_to_reddit` runs end-to-end with Claude as the orchestrator
2. Only ONE HITL gate fires — before the post is submitted — triggered by Claude's judgment
3. The HITL panel and browser show the same page at all times (no dual-browser drift)
4. No hardcoded step sequences exist in TypeScript — all flow logic lives in YAML + Claude
5. Gemini writes the copy when `write_copy` is called; Claude never writes copy itself
6. GPT-4o drives the browser when `browser_task` is called; Claude never navigates directly
7. `npx tsc --noEmit` passes, `npm test` passes, `npm run build` is clean

---

*This document is the single source of truth for the ai-vision v2 build.*  
*Do not start coding before reading the FORGE Build Protocol at the top of this file.*
