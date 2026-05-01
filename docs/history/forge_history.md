# forge_history.md — FORGE Story Archive

This file is the canonical long-form archive of completed FORGE story history entries.

## Append SOP (Mandatory)

When a story is completed and validated:
1. Add a new entry at the end of this file using the standard story template.
## Compacted Archive — US-005 Through US-028

Older completed stories are condensed below to keep this archive readable. The last five stories remain in full detail unchanged.

| Story | Date | Status | Pattern | Gotcha | Primary Files |
|---|---|---|---|---|---|
| `US-005` | 2026-04-18 | PASS | Centralize teardown in `wrap-up.ts`, keep encrypted pre-flight values in short-term memory, and gate sensitive input through explicit metadata plus phase-aware HITL UI. | Durable profiles must be persistent in both CDP and Playwright fallback startup paths. | `src/workflow/engine.ts`, `src/workflow/wrap-up.ts`, `src/memory/short-term.ts`, `src/session/hitl.ts`, `src/ui/server.ts` |
| `US-006` | 2026-04-18 | PASS | Emit typed telemetry at workflow/session/HITL/UI boundaries and persist it to SQLite/NDJSON with detector-based escalation. | UI telemetry/state must fetch current state on load, not only consume future WebSocket deltas. | `src/telemetry/manager.ts`, `src/workflow/wrap-up.ts`, `src/ui/server.ts`, `src/db/repository.ts` |
| `US-007` | 2026-04-19 | PASS | Treat `complete` and `error` as terminal UI states and add shutdown grace so final phase updates reach the browser. | The HITL UI and workflow runner share one process, so clean completion can look like a network failure without terminal-state awareness. | `src/ui/server.ts`, `src/cli/index.ts`, `src/session/types.ts` |
| `US-008` | 2026-04-19 | PASS | Use `human_takeover` in `confirm_completion` mode so the agent performs the final action and HITL verifies the visible outcome. | Do not let `/api/acknowledge` mutate phase or it can surface false final-confirmation UI. | `src/workflow/types.ts`, `src/workflow/engine.ts`, `src/session/hitl.ts`, `src/ui/server.ts` |
| `US-009` | 2026-04-19 | PASS | Capture final-step rejection reasons immediately, emit dedicated telemetry, record improvements, and force SIC wrap-up for rejection failures. | Optional QA comments are not a safe substitute for rejection-path reason capture. | `src/session/hitl.ts`, `src/workflow/engine.ts`, `src/ui/server.ts`, `src/workflow/wrap-up.ts` |
| `US-010` | 2026-04-19 | PASS | Add a dedicated QA-notes pause and generic `authVerification` login-skip contract for recurring authenticated workflows. | URL-only checks are too weak for safe authenticated login skipping. | `src/session/types.ts`, `src/workflow/types.ts`, `src/workflow/engine.ts`, `src/ui/server.ts` |
| `US-011` | 2026-04-19 | PASS | Recreate fresh `BrowserSession` objects after browser-use resets instead of relying on shallow CDP-only repair. | Reset browser-use sessions can still exist while lacking required event handlers. | `src/engines/browser-use/server/main.py`, `docs/artifacts/2026-04-19-x-hitl-fine-tuning-handoff.md` |
| `US-012` | 2026-04-23 | PASS | Post browser-use native step callbacks to `BROWSER_USE_CALLBACK_URL`, emit `browser_use.action.*` telemetry in Node, forward the live events over the UI WebSocket, and surface them into orchestrator state without polling. | The original bridge implementation landed while repo-wide typecheck was still blocked elsewhere, so the backlog record had to be reconciled later against the now-clean repo validation state. | `src/engines/browser-use/server/main.py`, `src/engines/python-bridge.ts`, `src/engines/python-bridge.test.ts`, `src/orchestrator/loop.ts`, `src/orchestrator/loop.test.ts`, `src/ui/server.ts` |
| `US-013` | 2026-04-19 | PASS | Resolve each step against live runtime context immediately before execution so same-run outputs remain available downstream. | Pre-resolving all steps at run start can erase placeholders before outputs exist. | `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `progress.txt` |
| `US-014` | 2026-04-19 | PASS | Treat `forge-memory.db` as the primary SIC persistence layer for improvements and self-heal triggers. | Keep deterministic local fallback behavior for non-FORGE runtime contexts. | `src/memory/forge-sic.ts`, `src/memory/long-term.ts`, `src/workflow/wrap-up.ts`, `FORGE.md` |
| `US-015` | 2026-04-19 | PASS | Enforce a single SIC writer path to FORGE `context_store` to prevent drift in promotion/self-heal history. | Strict FORGE mode will fail if `forge-memory.db` is missing or misaligned. | `src/memory/forge-sic.ts`, `src/workflow/wrap-up.ts`, `src/db/repository.ts`, `scripts/forge/migrate-sic-to-forge.ts` |
| `US-016` | 2026-04-19 | PASS | Route bridge exit handling through one lifecycle path and surface parity signals to HITL UI and MCP. | Only unexpected initialized-bridge exits should raise operator-facing alerts. | `src/engines/python-bridge.ts`, `src/ui/server.ts`, `src/mcp/server.ts` |
| `US-017` | 2026-04-19 | PASS | Keep runtime secrets out of `.env` by using a local Vault flow and shell-time export loading. | Vault bootstrap/export depends on both `curl` and `jq`. | `docker-compose.vault.yml`, `scripts/secrets/vault-init.sh`, `scripts/secrets/vault-export-env.sh`, `README.md` |
| `US-018` | 2026-04-19 | PASS | Run lockfile-faithful typecheck, tests, and build in GitHub Actions for push and PR validation. | Using `npm` in CI can drift from the pinned `pnpm` dependency graph. | `.github/workflows/ci.yml`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt` |
| `US-019` | 2026-04-21 | PASS | Capture the workflow step array before building `resolvedDefinition` so later getters cannot swap execution sources. | Spreading a workflow definition can re-trigger a `steps` getter and drift the loop. | `src/workflow/engine.ts`, `src/workflow/engine.test.ts` |
| `US-020` | 2026-04-23 | ARCHIVED-COMPLETE | Record the TSC crash diagnostic baseline with runtime baseline, Node 24 parity, layer classification, and bug-path procedures, then preserve it as historical diagnostic evidence after later remediation absorbs the active issue. | The diagnostic report captured a real baseline and ruled-in bug path, but later remediation and repo stabilization made it an archive record instead of active backlog. | `docs/debriefs/tsc-crash-bug-report.md`, `docs/artifacts/tsc-crash-forge-story.yaml`, `progress.txt` |
| `US-021` | 2026-05-01 | SUPERSEDED | Retire the stale remediation PRD entry because the repo already records the same remediation path as completed under `EN-006` and current typecheck evidence. | Leaving the mismatched story id open would cause future agents to reopen already-absorbed TSC crash work. | `prd.json`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`, `docs/artifacts/tsc-crash-remediation-forge-story.yaml` |
| `EN-008` | 2026-04-22 | PASS | Replace startup casts/inference seams with named typed boundaries at workflow, MCP, webhook, and UI startup edges. | Some conversions still require `as unknown as`; the goal is to isolate them at named boundaries. | `src/workflow/types.ts`, `src/mcp/server.ts`, `src/webhooks/server.ts`, `src/ui/server.ts` |
| `EN-009` | 2026-04-24 | PASS | Keep `ForgeMP/` canonical while providing `scripts/forge/` compatibility shims and a public `pnpm run forge` path. | A documented workflow is still broken if the operator-facing entrypoints are missing. | `package.json`, `FORGE.md`, `ForgeMP/forge-memory-client.ts`, `scripts/forge/forge.sh` |
| `US-022` | 2026-04-24 | PASS | Define direct gate contracts, insertion points, and ownership rules before retiring `mode: agentic`. | Approval state must be run-scoped, and precondition logic must move to the loop boundary before independent testing. | `docs/artifacts/2026-04-24-direct-workflow-gate-layer-design.md`, `prd.json`, `forge-memory.db`, `progress.txt` |
| `EN-010` | 2026-04-25 | PASS | Wrap the chief-engineer observer in a repo-owned daemon and cron installer that logs the active Forge storyline. | Generic repo-health monitoring is too weak; the daemon must report the active `agent_iterations` storyline from FORGE DB. | `scripts/chief-engineer/chief-engineer-daemon.sh`, `scripts/chief-engineer/install-chief-engineer-cron.sh` |
| `US-023` | 2026-04-25 | PASS | Keep `workflowEngine.currentState` as the canonical public projection and publish direct wait/terminal state through one engine-owned path. | Any direct terminal bypass around the canonical publisher leaves Phase 1 visibility incomplete. | `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `prd.json`, `progress.txt` |
| `EN-011` | 2026-04-25 | PASS | Make local and CI quality gates run the same committed Forge gate path. | Forge silently skips enforcement when the root `forge.gates.sh` entrypoint is absent. | `scripts/lint.mjs`, `forge.gates.sh`, `.github/workflows/forge.yml`, `package.json` |
| `US-024` | 2026-04-26 | PASS | Gate `/api/confirm-final-step` with run-phase, session-binding, and WebSocket-presence checks plus structured rejection telemetry. | `startUiServer()` must return `Promise<http.Server>` and mocked ws servers must expose `clients` in tests. | `src/ui/server.ts`, `src/ui/server.test.ts`, `prd.json`, `progress.txt` |
| `US-025` | 2026-04-26 | PASS | Gate `/api/return-control` with action-state plus run/session/client binding checks and emit matched rejection/completed telemetry. | The allowed phase/action pairs are intentionally narrow and should not be widened casually. | `src/ui/server.ts`, `src/ui/server.test.ts`, `prd.json`, `progress.txt` |
| `US-026` | 2026-04-27 | PASS | Enforce run-scoped approval before protected direct steps and consume approval immediately after protected execution. | Reusing approval across steps or runs weakens the gate silently. | `src/workflow/engine.ts`, `src/ui/server.ts`, `prd.json`, `progress.txt` |
| `US-027` | 2026-04-27 | PASS | Validate generated/preflight output and scan side-effect steps for unresolved placeholders before dispatch. | The downstream placeholder gate must run on the resolved substituted step, not the template. | `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `prd.json`, `progress.txt` |
| `US-028` | 2026-04-27 | PASS | Parse structured Reddit duplicate-check evidence after the check step and gate submit on valid no-duplicate evidence. | `DUPLICATE_RISK` blocks at the submit gate, not at parse time, so check-only workflows can still finish successfully. | `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `workflows/post_to_reddit.yaml`, `workflows/write_and_post_to_reddit.yaml` |

---

### [US-029] — Direct Workflow Gate Layer Phase 7: Browser Side-Effect/Postcondition Gate — 2026-04-27

**Status:** PASS
**Pattern:** Add optional postcondition metadata to direct side-effect step schemas, then run a local `validateBrowserPostcondition` helper after `executeStep(...)` so direct workflows can prove expected URL and output evidence before downstream steps continue; apply a built-in default gate to `submit_reddit_post` requiring both `/comments/` URL state and Reddit comments URL output evidence.
**Gotcha:** The postcondition gate must evaluate after the side-effect step returns but before the normal `!result.success` branch finalizes the step, otherwise a false-success browser step will be recorded as successful and can still leak into downstream confirmation or extract steps.
**Files:** `src/workflow/types.ts`, `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `workflows/post_to_reddit.yaml`, `workflows/write_and_post_to_reddit.yaml`, `prd.json`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`

---

### [US-030] — Direct Workflow Gate Layer Phase 8: Generalized Precondition/Skip Gate — 2026-04-27

**Status:** PASS
**Pattern:** Add one deterministic `evaluatePreconditionGate` helper before approval and `executeStep(...)` in the direct run loop to classify pre-execution decisions (`run`, `skip`, `fail`, `hitl`) and lift login/auth skip, generate preflight skip/fail, and navigate target-match skip into a single traceable control point.
**Gotcha:** Once precondition logic is lifted into the run loop, duplicate skip logic inside `executeStep` must be removed; keeping both layers causes double-skip semantics and inconsistent telemetry/order guarantees around approval and downstream gates.
**Files:** `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `prd.json`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt`

---

---

## H-031 — US-031 / RF-013: agent_task Side-Effect Safety Gate

**Date:** 2026-04-28
**Story:** US-031 / RF-013
**Status:** PASS
**Gate Layer Phase:** 9

### Summary

Implemented the `agent_task` side-effect safety boundary in the direct workflow engine. The implementation adds a deterministic prompt classifier (`classifyAgentTaskSideEffect`) and a safety gate inside `executeStep`'s `case 'agent_task':` branch that runs after the unresolved-placeholder check and before worker dispatch via `routeAgentTask`.

The classifier identifies nine intent kinds: `login`, `fill`, `submit`, `publish`, `final_click`, `post`, `external_mutation`, `read_only`, `unknown`. Protected intents (`login`, `fill`, `submit`, `publish`, `final_click`, `post`, `external_mutation`) trigger safety checks:

1. **Approval enforcement** — `login` and `fill` intents require `approvalGrantedForStep === true` (computed from run-loop approval gate state and passed to `executeStep`).
2. **Content evidence enforcement** — `post` and `publish` intents validate known content output keys (`reddit_post_text`, `post_text`, `post_body`, etc.) from merged runtime params; empty or TODO/placeholder values block dispatch.
3. **Reddit duplicate evidence enforcement** — prompts containing reddit/subreddit language with `submit`, `post`, or `final_click` intent require stored duplicate-check evidence (same validation as the run-loop gate, extended to cover non-canonical step ids).

Telemetry: `workflow.agent_task_side_effect.evaluated` always; `workflow.agent_task_side_effect.allowed` or `workflow.agent_task_side_effect.blocked` depending on outcome.

All existing US-026 through US-030 gates remain intact. `mode: agentic` routing and final HITL confirmation unchanged.

### Files Touched

- `src/workflow/engine.ts`
- `src/workflow/engine.test.ts`
- `prd.json`
- `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
- `progress.txt`

### Validation

- `pnpm run typecheck` → exit 0
- `pnpm test` → 11/11 suites, 128/128 tests passed

---

## H-032 — US-032 / RF-014: agent_task Dominant Intent Classification Fix

**Date:** 2026-04-28
**Story:** US-032 / RF-014
**Status:** PASS
**Gate Layer Phase:** 10

### Summary

Implemented dominant-intent resolution for `agent_task` prompt classification so mixed-intent prompts no longer use first-match behavior. The classifier now gathers all matched signals, then selects a deterministic dominant intent.

The ranking was updated so dominant workflow actions (`submit`, `publish`, `post`, `final_click`) are selected over fallback `fill` wording when both appear in the same prompt. Standalone `fill`, standalone `login`, and read-only behavior remain intact.

Classifier details now include:

- `matchedSignals`
- `dominantIntentSource`
- `selectedIntent`

Regression tests now load the exact live `workflows/post_to_reddit.yaml` `submit_reddit_post` prompt and verify dominant submit selection plus telemetry detail payloads. Safety gate behavior from US-031 remains active (approval for login/fill, posting content checks, Reddit duplicate evidence checks, browser postcondition checks).

### Files Touched

- `src/workflow/engine.ts`
- `src/workflow/engine.test.ts`
- `prd.json`
- `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
- `progress.txt`

### Validation

- `pnpm run typecheck` → exit 0
- `pnpm test` → 11/11 suites, 131/131 tests passed

---

## H-033 — US-033 / RF-015: Live Workflow Prompt Contract Regression Suite

**Date:** 2026-05-01
**Story:** US-033 / RF-015
**Status:** PASS
**Gate Layer Phase:** 11

### Summary

Implemented exact live workflow prompt contract coverage for the Reddit duplicate-check and submit `agent_task` steps.

`classifyAgentTaskSideEffect(...)` now recognizes the canonical `check_duplicate_reddit_post` step contract as evidence-producing read-only work using a narrow deterministic condition: the exact step id plus the structured duplicate-check output markers. This keeps the step executable before `reddit_duplicate_check_evidence` exists while preserving matched lexical signals in telemetry and recording why protected submit-like wording was suppressed for this specific evidence-producing path.

The live `submit_reddit_post` prompt remains protected as submit intent. Existing duplicate-evidence enforcement is unchanged: missing evidence still blocks submit, duplicate-risk evidence still blocks submit, and valid no-duplicate evidence still allows worker dispatch. Regression tests now load the exact live prompts from `workflows/post_to_reddit.yaml` instead of relying only on simplified fixtures.

### Files Touched

- `src/workflow/engine.ts`
- `src/workflow/engine.test.ts`
- `prd.json`
- `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
- `docs/debriefs/2026-04-26-hitl-gate-story-reference.md`
- `docs/history/forge_history.md`
- `docs/history/history_index.md`
- `progress.txt`

### Validation

- `npx jest src/workflow/engine.test.ts --runInBand` → 66/66 tests passed
- `pnpm run typecheck` → exit 0
- `pnpm test` → 11/11 suites, 133/133 tests passed

---

## H-034 — US-034 / RF-016: Backlog Reconciliation For US-012, US-020, US-021

**Date:** 2026-05-01
**Story:** US-034 / RF-016
**Status:** PASS
**Gate Layer Phase:** Governance

### Summary

Completed the governed backlog reconciliation pass for the three stale stories that no longer matched repo evidence.

`US-012` was closed as complete-with-evidence after reconciling the original bridge acceptance criteria against the implemented callback receiver in `src/engines/python-bridge.ts`, browser-use callback wiring in `src/engines/browser-use/server/main.py`, orchestrator live-event consumption, UI websocket forwarding, and the current repo validation state.

`US-020` was classified as archived-complete. The repo already contains the diagnostic baseline bug report and YAML story artifact, and later Node 24 parity evidence plus the EN-006 remediation path absorbed the active issue. Keeping it archived preserves the diagnostic record without leaving it as an open sprint candidate.

`US-021` was retired as superseded. The remediation path was already recorded as completed under `EN-006`, while the standalone US-021 remediation report artifact was never produced under that story id. Leaving it open would have kept a duplicate and misleading backlog entry alive.

This story also aligned the stale reference surfaces: PRD states, the backlog reference debrief, the compact FORGE history archive, the history index, the tracker row, and the story card now all agree on the terminal states of these three stories.

### Files Touched

- `prd.json`
- `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
- `docs/debriefs/2026-04-26-hitl-gate-story-reference.md`
- `docs/debriefs/tsc-crash-bug-report.md`
- `docs/artifacts/tsc-crash-forge-story.yaml`
- `docs/artifacts/tsc-crash-remediation-forge-story.yaml`
- `docs/artifacts/2026-05-01-us034-rf016-backlog-reconciliation-forge-story.yaml`
- `docs/history/forge_history.md`
- `docs/history/history_index.md`
- `progress.txt`

### Validation

- `jq empty prd.json` → exit 0
- `pnpm run typecheck` → exit 0
- `pnpm test` → 11/11 suites, 133/133 tests passed

---
