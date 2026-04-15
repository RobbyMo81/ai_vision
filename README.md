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

```
ai-vision CLI
     │
     ├── browser-use engine   ← Python/LangChain, headless Chromium (default)
     ├── stagehand engine     ← TypeScript/Playwright SDK
     └── skyvern engine       ← Computer-vision-centric automation
```

Each engine shares a common interface — swap between them with `--engine` without changing your prompt. The Python engines run as local FastAPI bridge servers managed automatically by the CLI.

---

## Quick Start

### 1. Prerequisites

- Node.js 18+
- Python 3.10+
- Rust (for the config GUI — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)

### 2. Install

```bash
git clone <repo>
cd ai-vision
npm install
npm run build
npm run config:build
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
|----------|-------|------|
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
node dist/cli/index.js run "Fill in the contact form on example.com" --engine stagehand
```

Available engines: `browser-use` (default), `stagehand`, `skyvern`

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

```
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
│   │   ├── stagehand/engine.ts        # StagehandEngine
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
STAGEHAND_LLM_PROVIDER=anthropic

# Model (must match provider)
STAGEHAND_LLM_MODEL=claude-sonnet-4-6

# API Keys (only the active provider's key is required)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Engine ports
BROWSER_USE_PORT=8001
SKYVERN_PORT=8002

# Storage
SESSION_DIR=./sessions
DB_PATH=./ai-vision.db
```

---

## Development

```bash
# Type-check without building
npm run typecheck

# Run tests
npm test

# Build TypeScript + copy Python bridge files
npm run build

# Rebuild the Rust config GUI
npm run config:build

# Run CLI from source (no build step)
npm run cli -- run "your prompt here"
```

---

## Known Limitations

- **CAPTCHAs** — headless browsers are increasingly blocked by Google, Bing, and Cloudflare. Direct content URLs work reliably; search engine results pages may require retries or manual CAPTCHA solving.
- **Long tasks** — complex multi-step tasks can take several minutes. The HTTP timeout is set to 10 minutes; tasks exceeding this will need to be broken into smaller steps.
- **Skyvern** — requires a running Skyvern server instance. See `src/engines/skyvern/server/requirements.txt`.
- **Model restart** — changing the LLM model via `config` takes effect on the next `run` command (the bridge server re-reads `.env` on startup).
