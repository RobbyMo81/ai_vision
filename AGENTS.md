# AGENTS.md — FORGE Institutional Memory
# Kirk Engineering Systems
# This file is read automatically by every Claude Code instance in the FORGE loop.
# Update after EVERY story. This is the ToM (Tier of Management) for this project.

---

## Project: [PROJECT NAME]
**Last Updated:** [DATE]
**Status:** Active build

---

## Architecture Overview
[Brief description of the system — written by first agent, updated as system grows]

## Key Files & Their Purpose
| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point |
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
```

## Patterns This Codebase Uses
- [Pattern 1: discovered by agent on date]
- [Pattern 2: ...]

## GOTCHAS — Read Before Writing Code
- [Gotcha 1: e.g., "Never call AlpacaClient directly — always use AlpacaGateway.ts"]
- [Gotcha 2: ...]

---

## Story History

<!-- Each agent appends one section below after completing a story -->

### [US-XXX] — [Story Title] — [Date]
**Status:** PASS | BLOCKED
**Pattern:** [What was discovered]
**Gotcha:** [What NOT to forget]
**Files:** [Key files changed]

---
