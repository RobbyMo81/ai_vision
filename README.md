# ai-vision

AI-driven browser automation platform. Give it a URL and a plain-English instruction — it navigates, clicks, types, and extracts information using a real browser controlled by an LLM.

---

## Use Case

Traditional browser automation (Selenium, Puppeteer) breaks every time a website changes its HTML structure. **ai-vision** replaces fragile CSS selectors with language-model reasoning: the agent _reads_ the page visually and semantically, decides what to do next, and adapts when things look different than expected.

**What you can do with it:**

- **Web research** — navigate to any URL, read the content, and return a structured summary
- **Form automation** — fill out multi-step forms using natural language descriptions of the fields
- **Data extraction** — scrape information from sites with dynamic or obfuscated UIs
- **UI testing** — run natural language test cases against live web apps without brittle selectors
- **Dashboard interaction** — log into internal tools and perform actions described in plain English
- **Process automation** — chain browser actions into end-to-end workflows (e.g. "search, filter, download, summarize")

**Who it is for:**

- Developers automating repetitive web workflows
- QA engineers writing human-readable browser tests
- Data teams extracting information from sites that block conventional scrapers
- Anyone who needs a browser agent they can talk to in plain English

---

## Architecture

```text
ai-vision CLI
     │
     ├── browser-use engine   ← Python/LangChain, headless Chromium (default)
     └── skyvern engine       ← Computer-vision-centric automation
```

Each engine shares a common interface — swap between them with `--engine` without changing your prompt. The Python engines run as local FastAPI bridge servers managed automatically by the CLI.

---

## Quick Start

### 1. Prerequisites

- Node.js 24.x
- Python 3.10+
- Rust (for the config GUI — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)

### 2. Install

```bash
git clone <repo>
cd ai-vision
pnpm install
pnpm run build
pnpm run config:build
```

### 3. Set up Python environment

```bash
python3 -m venv .venv
.venv/bin/pip install -r src/engines/browser-use/server/requirements.txt
.venv/bin/python3 -m playwright install chromium
```

### 4. Configure your LLM

Launch the interactive config GUI:

```bash
node dist/cli/index.js config
```

Navigate with arrow keys:

1. **Select provider** — `anthropic` or `openai`
2. **Select model** — pick your cost/capability tier
3. **Enter API key** — paste with `Ctrl+Shift+V`, clear with `Ctrl+U`
4. **Confirm** — press `Enter` to save to `.env`

| Provider | Model | Tier |
| --- | --- | --- |
| Anthropic | `claude-haiku-4-5-20251001` | Fastest · Cheapest |
| Anthropic | `claude-sonnet-4-6` | Balanced · **Recommended** |
| Anthropic | `claude-opus-4-6` | Most Capable · Most Expensive |
| OpenAI | `gpt-4o-mini` | Fastest · Cheapest |
| OpenAI | `gpt-4o` | Balanced · Recommended |
| OpenAI | `o3` | Most Capable · Most Expensive |

---

## Usage

### Run a task

```bash
node dist/cli/index.js run "Go to news.ycombinator.com and list the top 5 stories"
```

### Specify an engine

```bash
node dist/cli/index.js run "Fill in the contact form on example.com" --engine skyvern
```

Available engines: `browser-use` (default), `skyvern`

### Take a screenshot after the task

```bash
node dist/cli/index.js run "Navigate to github.com and describe the homepage" --screenshot
```

### View task history

```bash
node dist/cli/index.js history
node dist/cli/index.js history --limit 25
```

### List available engines

```bash
node dist/cli/index.js engines
```

### Change LLM model

```bash
node dist/cli/index.js config
```

---

## Project Structure

```text
ai-vision/
├── src/
│   ├── cli/index.ts                   # CLI entry point (commander)
│   ├── engines/
│   │   ├── interface.ts               # Shared AutomationEngine interface
│   │   ├── registry.ts                # Engine registry
│   │   ├── python-bridge.ts           # Base class for Python bridge engines
│   │   ├── browser-use/
│   │   │   ├── engine.ts              # BrowserUseEngine (TypeScript wrapper)
│   │   │   └── server/main.py         # FastAPI bridge server
│   │   └── skyvern/
│   │       ├── engine.ts              # SkyvernEngine (TypeScript wrapper)
│   │       └── server/main.py         # FastAPI bridge server
│   ├── db/repository.ts               # SQLite session storage
│   └── index.ts                       # Programmatic API entry point
├── tools/
│   └── config-gui/                    # Rust TUI for LLM configuration
│       └── src/main.rs
├── .env                               # Runtime config (gitignored)
├── .env.example                       # Config template
├── LLM_MODEL_IMPACT.md                # AI-agent reference: all LLM config touch points
└── package.json
```

---

## Configuration Reference

All runtime config lives in `.env`. Edit manually or use `node dist/cli/index.js config`.

```env
# LLM Provider: "anthropic" | "openai"
BROWSER_USE_LLM_PROVIDER=anthropic

# Model (must match provider)
BROWSER_USE_LLM_MODEL=claude-sonnet-4-6

# Optional provider-specific model overrides (recommended with fallback)
# BROWSER_USE_LLM_MODEL_ANTHROPIC=claude-sonnet-4-6
# BROWSER_USE_LLM_MODEL_OPENAI=gpt-4o

# Optional fallback provider for browser-use agent tasks
# If primary provider fails (quota/auth/rate limit), bridge retries once on fallback
# BROWSER_USE_LLM_FALLBACK_PROVIDER=openai

# API Keys (only the active provider's key is required)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Engine ports
BROWSER_USE_PORT=8001
SKYVERN_PORT=8002

# Storage
SESSION_DIR=./sessions
DB_PATH=./ai-vision.db

# SIC policy (FORGE-only by default)
AI_VISION_SIC_FORGE_STRICT=true
# FORGE_MEMORY_DB_PATH=./forge-memory.db
```

---

## Development

```bash
# Type-check without building
pnpm run typecheck

# Run tests
pnpm test

# Build TypeScript + copy Python bridge files
pnpm run build

# Rebuild the Rust config GUI
pnpm run config:build

# One-time SIC migration into FORGE memory
pnpm run sic:migrate:forge

# Run CLI from source (no build step)
pnpm run cli -- run "your prompt here"
```

## Critical Diagnostics

When `pnpm run typecheck` or `tsc --noEmit` fails on memory, classify the failure in this order before treating it as a TypeScript regression.

1. Compare the local Node runtime against the CI-pinned Node 24 baseline first. Version skew is the cheapest discriminator for runtime-layer regressions.
2. Treat a V8 crash ending in `SIGABRT` and `heap out of memory` as a Node self-abort unless you also have `SIGKILL`, cgroup limits, or `dmesg` OOM-killer evidence.
3. Only blame the TypeScript graph after Node-version parity and OS kill-path checks are ruled out.

Use this quick check sequence on Linux:

```bash
node -v
env | grep '^NODE_OPTIONS=' || true
pnpm exec tsc --noEmit --listFilesOnly | wc -l
pnpm exec tsc --noEmit --extendedDiagnostics || true
dmesg | grep -i "oom\|killed process\|out of memory" | tail -n 50 || true
free -h
ulimit -a
```

Expected interpretation:

- `SIGABRT` plus V8 fatal heap output: Node/V8 runtime abort path
- `SIGKILL` plus kernel or cgroup evidence: OS memory-pressure path
- Normal process exit with extreme `Instantiations`, `Memory used`, or `Check time`: TypeScript checker-path pathology

## Static Seams

- Keep runtime validation and compile-time contracts separate at subsystem boundaries. Large Zod unions should stay local to their owning module; downstream imports should consume static interfaces or DTOs.
- Treat SDK registration seams the same way. If a library API mixes schemas, handlers, and generic inference, contain that expansion behind one local helper instead of repeating the full generic shape across the file.
- If `tsc --noEmit` heap growth appears after adding a shared contract, inspect whether a runtime schema or generic-heavy helper leaked across a broad import surface before reaching for heap-size workarounds.

---

## Secrets Vault Container (Local)

Use a local HashiCorp Vault container so runtime secrets are not stored in `.env`.

### 1. Start Vault

```bash
pnpm run vault:up
```

Defaults:

- `VAULT_ADDR=http://127.0.0.1:8200`
- `VAULT_TOKEN=root`
- KV path: `secret/data/ai-vision`

### 2. Seed secrets from your shell environment

```bash
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...
export GEMINI_API_KEY=...
export BROWSER_USE_LLM_PROVIDER=openai
export BROWSER_USE_LLM_MODEL=gpt-4o
export BROWSER_USE_LLM_MODEL_ANTHROPIC=claude-sonnet-4-6
export BROWSER_USE_LLM_MODEL_OPENAI=gpt-4o
export BROWSER_USE_LLM_FALLBACK_PROVIDER=anthropic
pnpm run vault:init
```

### 3. Load secrets into the current shell before running ai-vision

```bash
eval "$(pnpm run -s vault:export)"
```

Then run commands normally (for example `pnpm run serve` or `pnpm run cli -- run "..."`).

### 4. Stop Vault

```bash
pnpm run vault:down
```

Notes:

- `vault-init` and `vault-export` require `curl` and `jq`.
- Keep `.env` for non-secret defaults only; prefer Vault for API keys.

---

## Engineering Trackers

- SIC / Refactor / Enhancement tracker: [docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md](docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md)
- FORGE governance baseline: [FORGE.md](FORGE.md)

## Artifact And Debrief Convention

- Save Forge story package files and governed story deliverables in `docs/artifacts/`.
- Save non-story explainers, debriefs, investigations, traces, reports, quick references, and architecture notes in `docs/debriefs/`.
- Use date-prefixed filenames: `YYYY-MM-DD-topic.md`.
- Do not add new explainer/report artifacts to repo root.

---

## Known Limitations

- **CAPTCHAs** — headless browsers are increasingly blocked by Google, Bing, and Cloudflare. Direct content URLs work reliably; search engine results pages may require retries or manual CAPTCHA solving.
- **Long tasks** — complex multi-step tasks can take several minutes. The HTTP timeout is set to 10 minutes; tasks exceeding this will need to be broken into smaller steps.
- **Skyvern** — requires a running Skyvern server instance. See `src/engines/skyvern/server/requirements.txt`.
- **Model restart** — changing the LLM model via `config` takes effect on the next `run` command (the bridge server re-reads `.env` on startup).
