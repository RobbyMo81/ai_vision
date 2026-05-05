# Application_Test.md — AI-Vision Full Audit & Test Report

> Historical audit snapshot. Stagehand was removed by `US-005`; current runtime engines are `browser-use` and `skyvern`. Do not use this file as a current release/source-of-truth document.

> **Authored for Claude** — This document is structured so a future Claude session can read it cold and immediately understand: what was tested, what broke, why it broke, how it can be fixed, and what the recommended improvement path is. Every finding is linked to a specific file and line number. Severity ratings guide triage priority.

---

## Context & Testing Methodology

**Date:** 2026-04-15  
**Branch:** `forge/mvp-setup`  
**Node.js:** v24.14.0  
**Python (venv):** 3.14.3  
**browser-use:** 0.12.2  
**Stagehand:** 1.14.0 (npm)  
**Rust/cargo:** 1.94.1  

### How This Document Was Produced

Testing was performed in four passes:

1. **Static Analysis** — Every source file was read in full. Type contracts, interface implementations, and cross-component assumptions were mapped.
2. **Automated Tests** — `npm run typecheck`, `npm test`, and `npm run build` were executed and output captured.
3. **Live CLI Probing** — Each CLI command was executed directly against the compiled `dist/` output. Edge cases (bad inputs, missing config, missing binary) were deliberately triggered.
4. **Server-Level Integration** — The Python bridge servers were started manually in isolation. Each REST endpoint was called with `curl` under normal and failure conditions. Python imports and API signatures were inspected against the installed library versions.

---

## Quick Reference: Severity Key

| Symbol | Severity | Meaning |
|--------|----------|---------|
| 🔴 | **CRITICAL** | Feature is completely broken or data is corrupted |
| 🟠 | **HIGH** | Feature fails under common real-world conditions |
| 🟡 | **MEDIUM** | Feature degrades or misleads; workaround exists |
| 🟢 | **LOW** | Minor polish, UX, or performance issue |
| ✅ | **PASS** | Works correctly as designed |

---

## Test Suite 1 — Static Analysis & Build Pipeline

### Test 1.1 — TypeScript Type Checker (`npm run typecheck`)

| Field | Detail |
|-------|--------|
| **Command** | `npm run typecheck` (tsc --noEmit) |
| **Result** | ✅ PASS — zero errors, zero warnings |
| **What Worked** | All TypeScript source files pass strict-mode type checking. Interfaces, generics, and return types are consistent across `src/`. |
| **Failures** | None |

---

### Test 1.2 — Unit Test Suite (`npm test`)

| Field | Detail |
|-------|--------|
| **Command** | `npm test` (Jest) |
| **Result** | ✅ PASS — 9 tests, 2 suites, 0 failures |
| **What Worked** | `interface.test.ts` correctly validates error inheritance chains (`AutomationError`, `EngineNotReadyError`, `NavigationError`). `registry.test.ts` validates singleton factory pattern, unknown engine rejection, and `closeAll()` on an empty registry. |
| **Failures** | None |

**Critical Observation — Coverage Gap:** The 9 passing tests cover only error classes and the engine registry factory. There are **zero integration tests** for:
- Engine initialization and cleanup lifecycle
- Python bridge server communication
- Database read/write operations
- CLI command parsing and output formatting
- The Stagehand engine's actual browser interaction

The test suite passes a green light while fundamental runtime failures exist (see Tests 2.x and 3.x below). **Passing tests do not mean the application works.**

---

### Test 1.3 — TypeScript Build (`npm run build`)

| Field | Detail |
|-------|--------|
| **Command** | `npm run build` |
| **Result** | ✅ PASS — TypeScript compiled, Python server files copied |
| **What Worked** | `tsc` emits clean output to `dist/`. The `copy-python` step copies Python bridge servers to `dist/engines/`. |
| **Failures** | None (but see Test 3.2 for a critical side effect of what is NOT copied) |

---

## Test Suite 2 — CLI Command Testing

### Test 2.1 — `--version` and `--help`

| Field | Detail |
|-------|--------|
| **Command** | `node dist/cli/index.js --version` / `--help` |
| **Result** | ✅ PASS |
| **What Worked** | Version (`0.1.0`) and help text print correctly. All four subcommands (`run`, `history`, `engines`, `config`) are listed with descriptions. |

---

### Test 2.2 — `engines` Command

| Field | Detail |
|-------|--------|
| **Command** | `node dist/cli/index.js engines` |
| **Result** | 🟡 PARTIAL PASS |
| **What Worked** | Correctly lists `browser-use`, `skyvern`, `stagehand`. |
| **Failure** | Every SQLite-touching command emits: `(node:XXXXX) ExperimentalWarning: SQLite is an experimental feature and might change at any time`. This appears on `stderr` for every `engines`, `history`, and `run` invocation — even when SQLite isn't relevant to the command's purpose. |
| **Why It Fails** | `SessionRepository` is instantiated unconditionally at CLI startup (`const repo = new SessionRepository()`) in `src/cli/index.ts:28`. The DB is opened and migrated at import time, regardless of which command is running. `node:sqlite` on Node 24 emits this warning when the module is first loaded. |
| **How to Improve** | Instantiate `SessionRepository` lazily — only inside the `run` and `history` command handlers where it's actually needed. This also removes an unnecessary file I/O operation for commands like `engines` and `config`. |
| **Proposed Improvement** | Move `const repo = new SessionRepository()` inside the `run` and `history` action callbacks. |

---

### Test 2.3 — `run` with Invalid Engine Name

| Field | Detail |
|-------|--------|
| **Command** | `node dist/cli/index.js run "test" --engine fake-engine` |
| **Result** | ✅ PASS |
| **What Worked** | Rejects unknown engine with: `Unknown engine 'fake-engine'. Available: browser-use, skyvern, stagehand`. Exits with code 1. |

---

### Test 2.4 — `history` Command

| Field | Detail |
|-------|--------|
| **Command** | `node dist/cli/index.js history` |
| **Result** | ✅ PASS (functional, with caveats) |
| **What Worked** | Reads from existing SQLite DB and prints formatted session records with `✓`/`✗` status indicators, engine, timestamp, and truncated prompt. Error messages for failed sessions are shown. |
| **Observed Output** | Three sessions from `2026-03-23` were returned correctly. One session showed an error from a prior version mismatch (`'ChatAnthropic' object has no attribute 'provider'`), demonstrating that error storage works end-to-end. |

---

### Test 2.5 — `config` Command (Rust TUI)

| Field | Detail |
|-------|--------|
| **Command** | `node dist/cli/index.js config` |
| **Result** | 🔴 CRITICAL FAIL in non-TTY environments |
| **What Failed** | The Rust binary crashes immediately with: `Error: Os { code: 6, kind: Uncategorized, message: "No such device or address" }`. Exit code 1. |
| **Why It Fails** | `ratatui` + `crossterm` require a real interactive terminal (TTY). When the CLI is run from a non-TTY context (CI pipelines, subshells, `script -c`, automated test runners), the Rust binary cannot initialize its terminal backend and panics. |
| **Confirmed** | The binary IS compiled and present at `tools/config-gui/target/release/ai-vision-config`. The failure is environment-dependent — it will work in a normal interactive shell session but fail in any automated or piped context. |
| **How to Improve** | Add a TTY check before invoking the binary: `process.stdout.isTTY`. If false, fall back to printing instructions for manual `.env` editing. Additionally, add `TERM` environment detection in the Rust binary itself to produce a human-readable error instead of an OS error code. |
| **Proposed Improvement** | In `src/cli/index.ts`, wrap the config spawn: `if (!process.stdout.isTTY) { console.error('Config GUI requires an interactive terminal. Edit .env manually.'); process.exit(1); }` |

---

### Test 2.6 — `run` with Stagehand Engine

| Field | Detail |
|-------|--------|
| **Command** | `node dist/cli/index.js run "test prompt" --engine stagehand` |
| **Result** | 🔴 CRITICAL FAIL |
| **What Failed** | `Error: this.stagehand.agent is not a function`. Task reports `Duration: 0ms`, `Status: failed`. |
| **Why It Fails** | `src/engines/stagehand/engine.ts:127` calls `this.stagehand.agent()`. The installed Stagehand package (v1.14.0) **does not have an `.agent()` method**. The actual Stagehand v1.14.0 API exposes: `stagehand.act()`, `stagehand.extract()`, `stagehand.observe()` — all on the `page` object, not on the `stagehand` instance itself. The `agent()` method was either planned for a future version or was an incorrect assumption about the API. |
| **Verified** | Inspected `Object.getOwnPropertyNames(Object.getPrototypeOf(staghandInstance))` — confirmed: `init`, `act`, `extract`, `observe`, `close`, `log`, `page`, `context`, `setActivePage`, `registerSignalHandlers`, `logger`, `env`, `initFromPage`. No `agent`. |
| **Additional Bug — Duration 0ms** | The `durationMs` timer starts at the top of `runTask()` (after `initialize()` has already completed). `this.stagehand.agent()` throws synchronously before any async work begins, so `Date.now() - start` is 0ms. This makes the timing data useless for debugging. |
| **How to Improve** | Replace `this.stagehand.agent().execute(prompt)` with the correct Stagehand API: navigate to a starting URL (or infer one from the prompt), then use `this.page.act({ action: prompt })` for simple tasks. For multi-step tasks, use `stagehand.act()` in a loop driven by `stagehand.observe()`. |
| **Proposed Improvement** | See code fix section at end of document. The `runTask()` in `StagehandEngine` must be rewritten to use `page.act()`. |

---

## Test Suite 3 — Database & Persistence

### Test 3.1 — SQLite Session Storage (Existing DB)

| Field | Detail |
|-------|--------|
| **Test** | Read back sessions from existing `ai-vision.db` |
| **Result** | ✅ PASS — sessions read correctly |
| **What Worked** | `DatabaseSync` + WAL mode works. The `list()` query returns correctly shaped `SessionRecord` objects. The `GROUP_CONCAT` / split approach handles paths without commas. Transactions with manual `BEGIN`/`COMMIT`/`ROLLBACK` function correctly. |

---

### Test 3.2 — Migration on Fresh Install (Critical Regression Path)

| Field | Detail |
|-------|--------|
| **Test** | Simulate running `node dist/cli/index.js run ...` on a machine where `ai-vision.db` does not yet exist |
| **Result** | 🔴 CRITICAL FAIL |
| **What Failed** | `INSERT INTO sessions ... no such table: sessions` |
| **Why It Fails** | `src/db/repository.ts:97` resolves the migration path as `path.resolve(__dirname, 'migrations/001_init.sql')`. When running from `dist/`, `__dirname` is `dist/db/`. The build's `copy-python` script copies Python servers but **never copies `src/db/migrations/`** to `dist/db/migrations/`. The `dist/db/` directory contains only `repository.js` and its map files. **The SQL migration file is absent from the build output.** |
| **Confirmed** | `ls dist/db/` → `repository.d.ts`, `repository.d.ts.map`, `repository.js`, `repository.js.map`. No `migrations/` folder. `fs.existsSync(migPath)` → `false`. Migration silently skipped. First INSERT crashes. |
| **The Existing DB is a Red Herring** | The current `ai-vision.db` was created during earlier development runs from `src/` (via `ts-node`), where `__dirname` correctly resolved to `src/db/` and the migration file existed. Any fresh machine using `dist/` will crash. |
| **How to Improve** | Add `cp -r src/db/migrations dist/db/` to the `copy-python` script in `package.json`. Alternatively, embed the migration SQL as a TypeScript string literal so it has no file dependency at runtime. |
| **Proposed Fix** | In `package.json`: `"copy-python": "cp -r src/engines/browser-use/server dist/engines/browser-use/ && cp -r src/engines/skyvern/server dist/engines/skyvern/ && cp -r src/db/migrations dist/db/"` |

---

### Test 3.3 — GROUP_CONCAT Comma-in-Path Bug

| Field | Detail |
|-------|--------|
| **Test** | Insert a session screenshot with a comma in its file path, then retrieve via `list()` |
| **Result** | 🟡 MEDIUM — data corruption on affected paths |
| **What Failed** | `src/db/repository.ts:92`: `r.screenshot_paths.split(',')`. If any screenshot path contains a comma (e.g., `/sessions/run,1/screenshot.png`), the split produces more elements than expected, corrupting the paths array. |
| **Why It Fails** | `GROUP_CONCAT` concatenates values with a plain comma delimiter. No escaping is applied. The split on `,` is naive. While screenshot filenames generated by the app today don't contain commas, user-supplied `outputPath` values could. |
| **How to Improve** | Use a delimiter that cannot appear in file paths, e.g., `GROUP_CONCAT(ss.path, '|')` and split on `\|`, or switch to a subquery that returns a JSON array: `json_group_array(ss.path)`. |
| **Proposed Fix** | Change SQL to `GROUP_CONCAT(ss.path, '||')` and split on `'||'`. Or better: `json_group_array(ss.path)` and `JSON.parse(r.screenshot_paths ?? '[]')`. |

---

## Test Suite 4 — Python Bridge Server (browser-use)

### Test 4.1 — Server Startup & Health Check

| Field | Detail |
|-------|--------|
| **Test** | Start `src/engines/browser-use/server/main.py` manually, call `GET /health` |
| **Result** | ✅ PASS |
| **What Worked** | FastAPI + uvicorn start cleanly. `GET /health` returns `{"status": "ok", "engine": "browser-use"}`. Startup time is ~1 second. |

---

### Test 4.2 — Browser Initialization (`POST /initialize`)

| Field | Detail |
|-------|--------|
| **Test** | Call `POST /initialize` against running bridge server |
| **Result** | ✅ PASS |
| **What Worked** | `BrowserSession(headless=True)` starts successfully. Chromium launches. Session state confirmed: `{"success": true}`. Viewport auto-configured to `2560x1440`. Playwright browser binaries at `~/.cache/ms-playwright/` are found and used. |

---

### Test 4.3 — Task Execution with Missing API Key

| Field | Detail |
|-------|--------|
| **Test** | Call `POST /task` with `{"prompt": "test task"}` and `ANTHROPIC_API_KEY=""` |
| **Result** | 🟠 HIGH — misleading success response |
| **What Failed** | The HTTP response is `200 OK` with `"success": true` even though all 6 agent steps failed due to authentication errors. The `output` field contains a raw `AgentHistoryList(...)` Python object string representation that is completely unreadable. |
| **Why It Fails** | `src/engines/browser-use/server/main.py:141-163`: The `try/except` block catches Python exceptions. But `agent.run()` **does not raise an exception** when all steps fail — it returns an `AgentHistoryList` object with `is_done=False` on every step. The server blindly calls `str(result)` and returns `success: True`. The TypeScript client in `src/engines/python-bridge.ts:131` trusts `res.success` directly and reports the task as successful to the user. |
| **Confirmed Behavior** | CLI would show: `Status: success`, `Output: AgentHistoryList(all_results=[ActionResult(is_done=False, ...` — a 2,000-character unreadable dump. |
| **Additional Findings** | The agent ran 6 retry steps before giving up, taking ~1.3 seconds. This means a missing API key causes a ~1.3 second delay before the misleading success response. The browser session also continues running after this, consuming memory. |
| **How to Improve** | Parse `AgentHistoryList` result properly. Check `result.is_done()` or inspect `result.all_results` for `is_done=True`. If no step completed successfully, return `success: False`. Extract the final meaningful output text, not `str(result)`. |
| **Proposed Fix** | After `result = await agent.run()`, add: `final = result.final_result(); return {"success": final is not None, "output": final or "No result produced", ...}` |

---

### Test 4.4 — Screenshots Never Captured in `/task`

| Field | Detail |
|-------|--------|
| **Test** | Observe screenshot capture during task execution |
| **Result** | 🟠 HIGH — feature not implemented |
| **What Failed** | `screenshots` array in `/task` response is always `[]`. |
| **Why It Fails** | `src/engines/browser-use/server/main.py:142`: `screenshots: list[dict] = []` is initialized but never populated. The browser-use `Agent` can produce screenshots (via `save_conversation_path` or step callbacks), but none of that is wired up. The TypeScript interface contract (`TaskResult.screenshots: Screenshot[]`) is never fulfilled by this engine. |
| **How to Improve** | Pass `save_conversation_path` to the `Agent` constructor to auto-save step screenshots. After `agent.run()`, glob the conversation path for `*.png` files and include them in the response. |
| **Proposed Fix** | `agent = Agent(task=req.prompt, llm=llm, browser_session=session, save_conversation_path=str(SESSION_DIR / "agent_steps"))` then collect from that path post-run. |

---

### Test 4.5 — `wait_until` Parameter Ignored in `/navigate`

| Field | Detail |
|-------|--------|
| **Test** | Inspect `/navigate` endpoint implementation |
| **Result** | 🟡 MEDIUM — dead interface option |
| **What Failed** | `NavigateRequest.wait_until` is defined in the request model (`src/engines/browser-use/server/main.py:55`) but never passed to `page.goto()`. Playwright's `goto()` supports `wait_until` but the call is `await page.goto(req.url)` with no options. |
| **How to Improve** | `await page.goto(req.url, wait_until=req.wait_until or "load")` |

---

### Test 4.6 — Screenshot Timestamp Collision Risk

| Field | Detail |
|-------|--------|
| **Test** | Inspect timestamp generation for screenshot filenames |
| **Result** | 🟡 MEDIUM — potential file overwrite |
| **What Failed** | `datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")` in both `main.py` files has only second-level resolution. Two rapid `/screenshot` calls within the same second produce identical filenames. The second write silently overwrites the first. |
| **How to Improve** | Use microsecond precision: `datetime.utcnow().strftime("%Y%m%dT%H%M%S%fZ")` or add a UUID suffix: `f"browser-use-{uuid.uuid4().hex[:8]}.png"`. |

---

## Test Suite 5 — Python Bridge Server (skyvern)

### Test 5.1 — Skyvern Package Not Installed

| Field | Detail |
|-------|--------|
| **Test** | `import skyvern` in the project venv |
| **Result** | 🔴 CRITICAL FAIL |
| **What Failed** | `ModuleNotFoundError: No module named 'skyvern'`. The Skyvern engine is completely non-functional on this machine. |
| **Why It Fails** | `src/engines/skyvern/server/requirements.txt` lists `skyvern>=0.1.0` but it was never installed in the `.venv`. The CLI lists `skyvern` as an available engine — no warning is given. Attempting to use it will hang for 30 seconds (startup health check timeout) and then crash. |
| **How to Improve** | Add an availability check. Before listing `skyvern` as available, verify `python3 -c "import skyvern"` succeeds. Add a note to README that Skyvern requires separate installation. |
| **Proposed Improvement** | Add an optional `available()` method to `AutomationEngine` that engines can override to signal whether their dependencies are present. The `engines` command should mark unavailable engines with a `[not installed]` indicator. |

---

### Test 5.2 — Skyvern API Assumptions (Static Analysis)

| Field | Detail |
|-------|--------|
| **Test** | Inspect `src/engines/skyvern/server/main.py` against Skyvern's actual API |
| **Result** | 🟠 HIGH — cannot be verified without package, but code has structural risks |
| **What Was Found** | `_get_skyvern()` instantiates `Skyvern(openai_api_key=..., anthropic_api_key=...)` without verifying this constructor signature is correct. `result.screenshots` attribute access uses `hasattr()` as a guard (good), but `isinstance(s, bytes)` assumes screenshot data is raw bytes — Skyvern may return file paths or base64 strings. `skyvern.navigate()`, `skyvern.click()`, `skyvern.type()`, `skyvern.screenshot()` are called as simple coroutines — actual Skyvern API may differ significantly. |
| **How to Improve** | Install Skyvern, run the server, and verify each endpoint against the actual API. Pin the Skyvern version in requirements.txt once verified. |

---

## Test Suite 6 — Stagehand Engine Deep Dive

### Test 6.1 — `stagehand.agent()` Does Not Exist

| Field | Detail |
|-------|--------|
| **Test** | Runtime execution of `node dist/cli/index.js run "test" --engine stagehand` |
| **Result** | 🔴 CRITICAL FAIL |
| **Error** | `this.stagehand.agent is not a function` |
| **Root Cause** | `src/engines/stagehand/engine.ts:127`: `const agent = this.stagehand.agent()`. Stagehand v1.14.0 has no `.agent()` method. The available methods on a `Stagehand` instance are: `init`, `close`, `act`, `extract`, `observe`, `log`, `page`, `context`, `env`, `logger`, `setActivePage`, `registerSignalHandlers`, `initFromPage`. |
| **Stagehand's Actual API** | The correct pattern is: `await this.page.goto(url)` (Playwright), then `await this.page.act({ action: 'do something' })` for natural language actions. `stagehand.act()` is the top-level wrapper but `page.act()` is the most direct. |
| **How to Improve** | Rewrite `runTask()` to use `page.act()`. For a general-purpose task without a known starting URL, the engine should attempt to extract a URL from the prompt using a regex heuristic, navigate to it, then call `page.act({ action: prompt })`. |

---

### Test 6.2 — Model Name Not Validated

| Field | Detail |
|-------|--------|
| **Test** | Static analysis of `src/engines/stagehand/engine.ts:38` |
| **Result** | 🟡 MEDIUM |
| **What Was Found** | `const model = (process.env.STAGEHAND_LLM_MODEL ?? 'claude-sonnet-4-6') as AvailableModel`. The `as AvailableModel` cast is a TypeScript compile-time assertion only. At runtime, any string in `STAGEHAND_LLM_MODEL` is passed to the Stagehand constructor without validation. If the model name is invalid (e.g., a typo from the config GUI), the error surfaces deep inside Stagehand initialization with a cryptic message. |
| **How to Improve** | Validate against Stagehand's `AvailableModelSchema` (exported from the package): `const parsed = AvailableModelSchema.safeParse(model); if (!parsed.success) throw new Error(...)`. |

---

### Test 6.3 — Browser Left Running on `initialize()` Success + `runTask()` Failure

| Field | Detail |
|-------|--------|
| **Test** | Observe process behavior when stagehand initializes (browser launches) but runTask throws |
| **Result** | 🟡 MEDIUM — resource leak |
| **What Happened** | Stagehand successfully opened Chromium (log: `local browser started successfully`). Then `runTask()` threw `agent is not a function`. The `catch` block in `runTask()` returns a failure result but does **not** close the browser. `registry.closeAll()` is called in the CLI's `run` handler after `runTask()`, which will close it — but only if the process doesn't crash first. |
| **Confirmed** | The CLI run test showed the browser launching and the process exiting cleanly with exit code 1. In this specific case, `closeAll()` ran properly. However, if an unhandled exception occurs elsewhere, the browser would be orphaned. |

---

## Test Suite 7 — Cross-Cutting Concerns

### Test 7.1 — VENV_PYTHON Fallback Logic

| Field | Detail |
|-------|--------|
| **Test** | `src/engines/python-bridge.ts:21`: `const VENV_PYTHON = path.join(PROJECT_ROOT, '.venv', 'bin', 'python3')` |
| **Result** | ✅ PASS on this machine — but fragile |
| **What Worked** | `.venv` exists at project root. `VENV_PYTHON` resolves correctly. `fs.existsSync(VENV_PYTHON)` returns true and the venv Python is used. |
| **Risk** | On Windows, the path would be `.venv\Scripts\python.exe`. The hardcoded `bin/python3` path will fail and silently fall back to the system `python3`, which may not have the required packages. |
| **How to Improve** | Use platform-aware path: `const VENV_PYTHON = process.platform === 'win32' ? path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe') : path.join(PROJECT_ROOT, '.venv', 'bin', 'python3')`. |

---

### Test 7.2 — Port Conflict Detection

| Field | Detail |
|-------|--------|
| **Test** | Analyze `_startSubprocess()` in `src/engines/python-bridge.ts` |
| **Result** | 🟡 MEDIUM |
| **What Was Found** | `spawn()` is called without checking if the target port is already occupied. If another process (or a previous unclean shutdown) holds port `8001` or `8002`, the Python server will fail to bind, log an error to stderr, and exit. The TypeScript `_waitForHealth()` loop will then run for the full `startupTimeoutMs` (30–90 seconds) before producing a timeout error. The user experiences a long hang with no explanation. |
| **How to Improve** | Before spawning, attempt a quick TCP connection to the port. If it succeeds, the port is busy — either reuse it (if it's a previous instance of the same server) or fail fast with a clear error. |

---

### Test 7.3 — Environment Variable Naming Convention

| Field | Detail |
|-------|--------|
| **Test** | Trace `STAGEHAND_LLM_PROVIDER` and `STAGEHAND_LLM_MODEL` through all components |
| **Result** | 🟢 LOW — confusion risk, not a functional bug |
| **What Was Found** | These variables are named with `STAGEHAND_` prefix but are used by all three engines. The browser-use Python server reads `STAGEHAND_LLM_PROVIDER` and `STAGEHAND_LLM_MODEL`. The Rust config GUI writes these keys. Stagehand reads them too. The names imply they're Stagehand-specific when they're actually global LLM config. This will cause confusion when adding a fourth engine or when explaining config to new users. |
| **How to Improve** | Rename to `AI_VISION_LLM_PROVIDER` and `AI_VISION_LLM_MODEL`. Update all references: Rust GUI, both Python servers, `StagehandEngine`, `.env.example`, and README. |

---

### Test 7.4 — SQLite ExperimentalWarning Spam

| Field | Detail |
|-------|--------|
| **Test** | All CLI commands that touch the database |
| **Result** | 🟢 LOW — cosmetic |
| **What Failed** | Every invocation prints `(node:XXXXX) ExperimentalWarning: SQLite is an experimental feature and might change at any time` on stderr. This appears on `engines`, `history`, and `run` commands. |
| **Why** | `node:sqlite` is in experimental status in Node 24. The warning is emitted on first module load. Since `SessionRepository` is instantiated at CLI startup, it's always triggered. |
| **How to Improve** | Use `--no-deprecation` flag in the CLI shebang or bin entry: `#!/usr/bin/env node --no-deprecation`. Alternatively, use a stable SQLite library like `better-sqlite3` which does not have this warning. |

---

### Test 7.5 — Global Python Session State (Thread Safety)

| Field | Detail |
|-------|--------|
| **Test** | Static analysis of both Python bridge servers |
| **Result** | 🟠 HIGH — race condition under concurrent load |
| **What Was Found** | Both `main.py` files use a module-level global (`_session` / `_skyvern_app`). FastAPI uses `asyncio` and can process multiple requests concurrently. Two concurrent `POST /initialize` calls will both check `if _session is None`, both pass, and both attempt `BrowserSession.start()` — corrupting `_session` with whichever finishes last. Subsequent requests may use a partially-initialized session. |
| **How to Improve** | Add an `asyncio.Lock` around the lazy initialization: `_init_lock = asyncio.Lock()` and `async with _init_lock: if _session is None: ...`. |

---

### Test 7.6 — Rust Config GUI `.env` File Search

| Field | Detail |
|-------|--------|
| **Test** | Run config GUI binary from `/tmp` directory |
| **Result** | 🟠 HIGH — wrong `.env` discovered or none at all |
| **What Happened** | Running from `/tmp` with no `.env` in any ancestor directory: the binary crashes with `Error: Os { code: 6, kind: Uncategorized, message: "No such device or address" }` (TTY failure, see Test 2.5). |
| **Static Analysis Finding** | `tools/config-gui/src/main.rs:253-267`: `find_env_path()` walks up from `current_dir()`. If the user `cd`s to `/home/user/projects/`, which also contains a `.env` for a different project, the config GUI will find and modify the wrong file. There is no validation that the found `.env` belongs to ai-vision. |
| **How to Improve** | Check for a sentinel value in the found `.env` (e.g., a comment `# ai-vision config`) or require the `--project-dir` flag when run outside the project directory. |

---

## Test Suite 8 — Integration Completeness

### Test 8.1 — End-to-End `run` Command (browser-use)

| Field | Detail |
|-------|--------|
| **Status** | Not testable without a valid API key in the current environment |
| **What Is Known to Work** | Server starts ✅, browser initializes ✅, task dispatches to agent ✅ |
| **What Is Known to Fail** | Without API key: misleading `success:true` ❌. Screenshots never populated ❌. `str(result)` output is unreadable ❌. |
| **Historical Evidence** | Two successful sessions in DB from `2026-03-23` confirm the engine worked in a previous session with a valid key. One failed session shows `'ChatAnthropic' object has no attribute 'provider'` — this error came from an older version of browser-use (pre-0.12.x). The current version (0.12.2) does have the `provider` attribute, so that specific error should no longer occur. |

---

### Test 8.2 — End-to-End `run` Command (stagehand)

| Field | Detail |
|-------|--------|
| **Status** | 🔴 COMPLETELY BROKEN |
| **Reason** | `stagehand.agent()` does not exist in v1.14.0. Zero tasks can be run with this engine until the API is fixed. |

---

### Test 8.3 — End-to-End `run` Command (skyvern)

| Field | Detail |
|-------|--------|
| **Status** | 🔴 NOT INSTALLABLE |
| **Reason** | `skyvern` Python package not installed. Will timeout after 30 seconds attempting health check then fail. |

---

## Summary Dashboard

| # | Test | Engine/Component | Severity | Status |
|---|------|-----------------|----------|--------|
| 1.1 | TypeScript type check | All | — | ✅ PASS |
| 1.2 | Unit tests | Error classes, Registry | — | ✅ PASS |
| 1.3 | Build pipeline | Build system | — | ✅ PASS |
| 2.1 | `--version` / `--help` | CLI | — | ✅ PASS |
| 2.2 | `engines` command + SQLite warning | CLI / DB | 🟢 LOW | PARTIAL |
| 2.3 | Invalid engine rejection | CLI | — | ✅ PASS |
| 2.4 | `history` command | CLI / DB | — | ✅ PASS |
| 2.5 | `config` command / Rust GUI | Config GUI | 🟠 HIGH | FAILS (no TTY) |
| 2.6 | `run --engine stagehand` | Stagehand | 🔴 CRITICAL | BROKEN |
| 3.1 | SQLite read/write | DB | — | ✅ PASS |
| 3.2 | Migration on fresh install | DB / Build | 🔴 CRITICAL | FAILS |
| 3.3 | GROUP_CONCAT comma-in-path | DB | 🟡 MEDIUM | BUG |
| 4.1 | browser-use server health | browser-use | — | ✅ PASS |
| 4.2 | browser-use `/initialize` | browser-use | — | ✅ PASS |
| 4.3 | Task with missing API key | browser-use | 🟠 HIGH | MISLEADING |
| 4.4 | Screenshots in task | browser-use | 🟠 HIGH | NOT IMPLEMENTED |
| 4.5 | `wait_until` in navigate | browser-use | 🟡 MEDIUM | IGNORED |
| 4.6 | Screenshot timestamp collision | browser-use | 🟡 MEDIUM | RISK |
| 5.1 | Skyvern package installed | Skyvern | 🔴 CRITICAL | NOT INSTALLED |
| 5.2 | Skyvern API assumptions | Skyvern | 🟠 HIGH | UNVERIFIABLE |
| 6.1 | `stagehand.agent()` API | Stagehand | 🔴 CRITICAL | BROKEN |
| 6.2 | Model name validation | Stagehand | 🟡 MEDIUM | MISSING |
| 6.3 | Browser resource leak | Stagehand | 🟡 MEDIUM | PARTIAL RISK |
| 7.1 | VENV_PYTHON Windows path | Python bridge | 🟡 MEDIUM | WINDOWS BROKEN |
| 7.2 | Port conflict detection | Python bridge | 🟡 MEDIUM | MISSING |
| 7.3 | Env var naming convention | All | 🟢 LOW | CONFUSING |
| 7.4 | SQLite warning spam | CLI | 🟢 LOW | COSMETIC |
| 7.5 | Global session thread safety | Python servers | 🟠 HIGH | RACE CONDITION |
| 7.6 | Rust GUI `.env` search | Config GUI | 🟠 HIGH | CWD-DEPENDENT |
| 8.1 | E2E browser-use (with key) | browser-use | — | HISTORICALLY WORKED |
| 8.2 | E2E stagehand | Stagehand | 🔴 CRITICAL | BROKEN |
| 8.3 | E2E skyvern | Skyvern | 🔴 CRITICAL | NOT INSTALLED |

---

## Prioritized Fix List

### P0 — Must Fix Before Any Production Use

**1. Fix Stagehand `runTask()` API mismatch**
- File: `src/engines/stagehand/engine.ts:127`
- Replace `this.stagehand.agent().execute(prompt)` with `page.act({ action: prompt })`
- Full proposed replacement for `runTask()`:
```typescript
async runTask(prompt: string): Promise<TaskResult> {
  this._assertReady();
  const start = Date.now();
  const screenshots: Screenshot[] = [];
  try {
    // Extract URL from prompt if present, otherwise start at about:blank
    const urlMatch = prompt.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      await this.page.goto(urlMatch[0], { waitUntil: 'domcontentloaded' });
    }
    await this.page.act({ action: prompt });
    const shot = await this.screenshot();
    screenshots.push(shot);
    return {
      success: true,
      output: `Task completed: ${prompt}`,
      screenshots,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      screenshots,
      durationMs: Date.now() - start,
    };
  }
}
```

**2. Add migration SQL copy to build script**
- File: `package.json`
- Change `"copy-python"` to also copy migrations:
```json
"copy-python": "cp -r src/engines/browser-use/server dist/engines/browser-use/ && cp -r src/engines/skyvern/server dist/engines/skyvern/ && mkdir -p dist/db/migrations && cp src/db/migrations/*.sql dist/db/migrations/"
```

**3. Fix browser-use `/task` success detection**
- File: `src/engines/browser-use/server/main.py`
- After `result = await agent.run()`, check if the task actually succeeded:
```python
final = result.final_result()
success = final is not None
output = str(final) if final else "Agent completed without producing a result"
return {"success": success, "output": output, "screenshots": screenshots, "duration_ms": duration_ms}
```

**4. Install Skyvern or disable the engine**
- Either: `pip install skyvern` in the venv and verify the API
- Or: Add a runtime availability check that marks skyvern as unavailable until installed

---

### P1 — Fix Before Sharing With Others

**5. Add TTY check before config binary invocation** (`src/cli/index.ts`)

**6. Lazily instantiate SessionRepository** (`src/cli/index.ts`) — fixes SQLite warning on `engines` command

**7. Fix `wait_until` forwarding in browser-use navigate** (`src/engines/browser-use/server/main.py`)

**8. Add asyncio.Lock for session initialization** (both Python servers)

**9. Fix screenshot timestamp to microsecond precision** (both Python servers)

---

### P2 — Quality Improvements

**10. Fix GROUP_CONCAT path split** (`src/db/repository.ts`) — use `json_group_array` or `||` delimiter

**11. Add Windows-compatible VENV_PYTHON path** (`src/engines/python-bridge.ts`)

**12. Add port conflict detection** (`src/engines/python-bridge.ts`)

**13. Implement screenshot capture in browser-use `/task`** (`src/engines/browser-use/server/main.py`)

**14. Rename `STAGEHAND_LLM_*` to `AI_VISION_LLM_*`** — all configuration files

**15. Add model name validation in StagehandEngine** (`src/engines/stagehand/engine.ts`) using `AvailableModelSchema`

---

## What Works Well (Preserve These)

The following components are well-built and should be treated as stable foundations:

- **Engine interface and registry pattern** (`src/engines/interface.ts`, `src/engines/registry.ts`) — clean, extensible, well-tested. The factory + singleton pattern is correct.
- **PythonBridgeEngine base class** (`src/engines/python-bridge.ts`) — the process lifecycle management, health check polling, and HTTP client abstraction are solid. The subprocess stdio forwarding with engine-id prefixes is useful for debugging.
- **Database transaction handling** (`src/db/repository.ts`) — manual `BEGIN`/`COMMIT`/`ROLLBACK` pattern is correct. WAL mode is appropriate.
- **CLI command structure** (`src/cli/index.ts`) — commander.js usage is clean. Invalid engine validation, session ID generation, and exit code handling are correct.
- **browser-use server startup and health** — the FastAPI bridge pattern, lifespan handler, and request model definitions are well-structured and function correctly.
- **Rust TUI architecture** — ratatui/crossterm implementation is idiomatic. The `.env` read/write logic (despite its edge cases) correctly handles the common case. The model selection UI design is clear.
- **Unit test quality** — the existing 9 tests are well-written and test real behavior (not just types). They provide a reliable baseline.

---

## Recommendations for Claude in Future Sessions

If you are a future Claude instance working on this codebase, here is what you need to know immediately:

1. **The Stagehand engine is broken.** Don't try to run it. Fix `runTask()` first per the P0 fix above.
2. **Fresh installs will crash on first `run`.** The migration SQL is not in `dist/`. Fix `package.json` copy script.
3. **`success: true` from browser-use means nothing without a valid API key.** Always check the output text for error content.
4. **Skyvern is not installed.** Don't assume it works. It needs `pip install skyvern` plus API verification.
5. **The database already has tables** — the existing `ai-vision.db` was created from `src/` not `dist/`. Fresh `dist/`-based usage needs the migration fix.
6. **There is a real Anthropic API key in the git history** from a prior `.env` that was committed. Assume it has been rotated. Do not try to use the key from commit history.
7. **The 3 unit tests that pass are not integration tests.** A green `npm test` does not mean the engines work.
8. **browser-use v0.12.2 is installed** in `.venv`. The `BrowserSession`, `Agent`, and `ChatAnthropic` APIs are compatible with the bridge server code. The only known previous failure (`'ChatAnthropic' object has no attribute 'provider'`) was from an older version and no longer applies.
9. **Playwright Chromium is installed** at `~/.cache/ms-playwright/chromium-1208`. Browser automation can actually run.
10. **The P0 fixes are small** — the Stagehand API fix is ~15 lines, the migration copy is one command, and the success-detection fix is ~5 lines. This is close to working.
