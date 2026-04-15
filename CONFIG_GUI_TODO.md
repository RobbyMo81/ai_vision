# Config GUI — Task Plan

## Objective
Build a Rust TUI (terminal GUI) that users launch via `ai-vision config` to change LLM provider/model/API keys without manually editing `.env`.

---

## Phase 1 — Grep & Impact Audit ✅
- [x] Search entire codebase for every LLM model/provider reference
- [x] Write findings to `LLM_MODEL_IMPACT.md` (YAML-enhanced for AI agent search)

---

## Phase 2 — Rust GUI (`tools/config-gui/`) ✅
- [x] `tools/config-gui/Cargo.toml` — ratatui + crossterm
- [x] `src/main.rs` — 3-screen TUI (Provider → Model → API Key → Confirm)
- [x] `.env` writer — updates keys in-place, preserves comments and unrelated keys
- [x] Keyboard nav: ↑↓ navigate, Enter select, ←/Bksp back, Tab toggle key visibility, q quit
- [x] Compiled to `tools/config-gui/target/release/ai-vision-config`

---

## Phase 3 — CLI Integration ✅
- [x] `config` subcommand added to `src/cli/index.ts` — spawns Rust binary
- [x] `config:build` script added to `package.json`
- [x] `config` script added to `package.json` (dev shortcut via ts-node)

---

## Phase 4 — Engine Default Consistency ✅
- [x] `src/engines/browser-use/server/main.py` — default provider → `anthropic`
- [x] `src/engines/stagehand/engine.ts` — default provider → `anthropic`, model → `claude-sonnet-4-6`
- [x] `.env.example` — defaults aligned: `anthropic` / `claude-sonnet-4-6`
- [x] All three sources now agree on the same defaults

---

## Phase 5 — Verification Against Impact Manifest ✅
- [x] GUI writes STAGEHAND_LLM_PROVIDER, STAGEHAND_LLM_MODEL, API key atomically
- [x] Python bridge re-reads .env on server start (load_dotenv handles this)
- [x] Stagehand engine re-reads process.env on init (restart required — noted in GUI)
- [x] `ai-vision config` command works from compiled CLI
- [x] Binary resolves correctly from both src/ and dist/ contexts
- [x] All impact manifest defaults consistent across engines

---

## How to use

```bash
# Launch the config GUI
npm run cli -- config          # from source (dev)
node dist/cli/index.js config  # from compiled dist

# Rebuild Rust binary after editing tools/config-gui/src/main.rs
npm run config:build
```
