# FORGE History Index — Library Card Catalog

This file is the quick-reference catalog for FORGE story history.

Primary archive path: `/home/spoq/ai-vision/docs/history/forge_history.md`
Index path: `/home/spoq/ai-vision/docs/history/history_index.md`

## History Archiving SOP (Mandatory)

Use this SOP after any completed story (`US-*`, `RF-*`, `EN-*`) with final validation evidence:
1. Append the full story narrative to `/home/spoq/ai-vision/docs/history/forge_history.md`.
2. Append one new library card row to this file.
3. Keep cards append-only by completion date.
4. Keep `AGENTS.md` free of long-form story payloads.
5. If the story changes behavior, also record Summary of Work in `progress.txt`.

## Card Template

| Card | Story | Date | Status | Domain | Pattern (Quick Ref) | Primary Files |
|---|---|---|---|---|---|---|
| H-### | US-000 / RF-000 / EN-000 | YYYY-MM-DD | PASS/FAIL/BLOCKED | Area | One-line reusable pattern | `path/a`, `path/b` |

## Library Cards

| Card | Story | Date | Status | Domain | Pattern (Quick Ref) | Primary Files |
|---|---|---|---|---|---|---|
| H-001 | US-005 | 2026-04-18 | PASS | HITL + Memory | Centralize teardown in wrap-up and gate sensitive fields via schema metadata | `src/workflow/wrap-up.ts`, `src/session/hitl.ts` |
| H-002 | US-006 | 2026-04-18 | PASS | Telemetry | Emit typed telemetry at boundaries and escalate via detector layer | `src/telemetry/manager.ts`, `src/workflow/wrap-up.ts` |
| H-003 | US-007 | 2026-04-19 | PASS | HITL UX | Treat complete/error as terminal UI states with shutdown grace | `src/ui/server.ts`, `src/cli/index.ts` |
| H-004 | US-008 | 2026-04-19 | PASS | HITL Confirmation | Use `confirm_completion` mode for irreversible final-step verification | `src/workflow/engine.ts`, `src/session/hitl.ts` |
| H-005 | US-009 | 2026-04-19 | PASS | SIC | Capture structured rejection reason and trigger SIC on final-step reject | `src/session/hitl.ts`, `src/workflow/wrap-up.ts` |
| H-006 | US-010 | 2026-04-19 | PASS | Auth + HITL | Add QA pause and explicit authVerification contract for login gates | `src/workflow/engine.ts`, `src/ui/server.ts` |
| H-007 | US-011 | 2026-04-19 | PASS | Browser Bridge | Recreate browser-use session objects after reset boundaries | `src/engines/browser-use/server/main.py` |
| H-008 | US-012 | 2026-04-23 | PASS | Browser-Use Live Event Bridge | Post browser-use callbacks to the Node bridge, emit `browser_use.action.*`, forward live UI events, and surface mid-task state without polling | `src/engines/python-bridge.ts`, `src/orchestrator/loop.ts`, `src/ui/server.ts` |
| H-009 | US-013 | 2026-04-19 | PASS | Workflow Runtime | Resolve placeholders immediately before step execution from live outputs | `src/workflow/engine.ts`, `src/workflow/engine.test.ts` |
| H-010 | US-014 | 2026-04-19 | PASS | SIC Persistence | Use FORGE DB as primary SIC storage with deterministic fallback behavior | `src/memory/forge-sic.ts`, `src/workflow/wrap-up.ts` |
| H-011 | US-015 | 2026-04-19 | PASS | Governance | Enforce single SIC writer path to FORGE context_store | `src/memory/long-term.ts`, `src/workflow/wrap-up.ts` |
| H-012 | US-016 | 2026-04-19 | PASS | MCP + UI Signals | Route bridge exits through one lifecycle and fan out parity signals | `src/engines/python-bridge.ts`, `src/mcp/server.ts` |
| H-013 | US-017 | 2026-04-19 | PASS | Secrets | Keep runtime secrets in local Vault flow, not `.env` payload | `scripts/secrets/vault-init.sh`, `README.md` |
| H-014 | US-018 | 2026-04-19 | PASS | CI | Run lockfile-faithful typecheck/test/build on push + PR | `.github/workflows/ci.yml` |
| H-015 | US-019 | 2026-04-21 | PASS | Workflow Determinism | Capture step arrays before spreads to avoid getter source drift | `src/workflow/engine.ts`, `src/workflow/engine.test.ts` |
| H-016 | US-020 | 2026-04-23 | ARCHIVED-COMPLETE | TypeScript Crash Diagnostics | Preserve the diagnostic baseline artifact after Node 24 parity evidence and later remediation absorb the active issue | `docs/debriefs/tsc-crash-bug-report.md`, `docs/artifacts/tsc-crash-forge-story.yaml` |
| H-017 | US-021 | 2026-05-01 | SUPERSEDED | Backlog Reconciliation | Retire stale remediation story id as superseded by completed EN-006 evidence and current passing typecheck path | `prd.json`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `docs/artifacts/tsc-crash-remediation-forge-story.yaml` |
| H-018 | EN-008 | 2026-04-22 | PASS | Startup Boundaries | Replace startup casts/inference seams with named typed boundaries | `src/workflow/types.ts`, `src/ui/server.ts` |
| H-019 | EN-009 | 2026-04-24 | PASS | Forge Tooling | Keep `ForgeMP/` canonical with `scripts/forge` compatibility shims | `package.json`, `scripts/forge/forge.sh` |
| H-020 | US-022 | 2026-04-24 | PASS | Gate Layer Design | Define direct gate contracts and insertion map before retirement work | `docs/artifacts/2026-04-24-direct-workflow-gate-layer-design.md` |
| H-021 | EN-010 | 2026-04-25 | PASS | Supervision | Use daemon+cron wake cycle and log active storyline from FORGE DB | `scripts/chief-engineer/chief-engineer-daemon.sh` |
| H-022 | US-023 | 2026-04-25 | PASS | HITL Publication | Publish wait/terminal state through one canonical engine state path | `src/workflow/engine.ts`, `src/workflow/engine.test.ts` |
| H-023 | EN-011 | 2026-04-25 | PASS | Quality Gates | Make local and CI both run committed `forge:gates` command path | `forge.gates.sh`, `.github/workflows/forge.yml` |
| H-024 | US-024 | 2026-04-26 | PASS | HITL Pre-flight | Gate final confirmation by phase/session/websocket presence pre-flight | `src/ui/server.ts`, `src/ui/server.test.ts` |
| H-025 | US-025 | 2026-04-26 | PASS | HITL Resume Gate | Gate return-control by allowed action state plus session/client binding with rejection/completed telemetry parity | `src/ui/server.ts`, `src/ui/server.test.ts` |
| H-026 | US-026 | 2026-04-27 | PASS | Workflow Approval Gate | Enforce run-scoped approval before protected direct steps and consume approval after execution | `src/workflow/engine.ts`, `src/ui/server.ts` |
| H-027 | US-027 | 2026-04-27 | PASS | Content Validation Gate | Validate generated and preflight output before downstream side effects; reject empty/placeholder/unresolved values and downstream `{{key}}` tokens in side-effect steps | `src/workflow/engine.ts`, `src/workflow/engine.test.ts` |
| H-028 | US-028 | 2026-04-27 | PASS | Duplicate Evidence Gate | Parse Reddit duplicate-check structured evidence after check step; gate submit_reddit_post on valid no-duplicate evidence before executeStep | `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `workflows/post_to_reddit.yaml`, `workflows/write_and_post_to_reddit.yaml` |
| H-029 | US-029 | 2026-04-27 | PASS | Browser Postcondition Gate | Validate direct-path browser side effects after execution using expected URL and output evidence; block false-success Reddit submit before downstream confirmation | `src/workflow/types.ts`, `src/workflow/engine.ts`, `src/workflow/engine.test.ts`, `workflows/post_to_reddit.yaml`, `workflows/write_and_post_to_reddit.yaml` |
| H-030 | US-030 | 2026-04-27 | PASS | Precondition Skip Gate | Evaluate direct-path preconditions before approval/executeStep and deterministically skip/fail auth, preflight generation, and redundant navigation paths | `src/workflow/engine.ts`, `src/workflow/engine.test.ts` |
| H-031 | US-031 | 2026-04-28 | PASS | agent_task Side-Effect Safety Gate | Classify agent_task prompt intent before worker dispatch; block login/fill without approval, post/publish with invalid content, reddit submit without duplicate evidence | `src/workflow/engine.ts`, `src/workflow/engine.test.ts` |
| H-032 | US-032 | 2026-04-28 | PASS | agent_task Dominant Intent Fix | Collect matched intent signals and select dominant workflow intent so submit/publish/post/final-click override fallback fill wording while preserving safety gates | `src/workflow/engine.ts`, `src/workflow/engine.test.ts` |
| H-033 | US-033 | 2026-05-01 | PASS | Live Prompt Contract Gate | Treat the exact duplicate-check step contract as evidence-producing read-only work while keeping live submit prompts protected by duplicate evidence gates | `src/workflow/engine.ts`, `src/workflow/engine.test.ts` |
| H-034 | US-034 | 2026-05-01 | PASS | Backlog Reconciliation | Close US-012 with evidence, archive US-020, supersede US-021, and align PRD/tracker/history naming so stale backlog does not reopen | `prd.json`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `docs/history/forge_history.md`, `progress.txt` |
| H-035 | US-035 | 2026-05-01 | PASS | Screenshot Security Design | Classify screenshot branches, make durable screenshots opt-in evidence artifacts, block sensitive capture phases, and define forward-only persistence and audit policy before runtime implementation stories | `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design.md`, `prd.json`, `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`, `progress.txt` |
| H-036 | US-036 | 2026-05-01 | PASS | Screenshot Payload Contract | Add canonical screenshot payload metadata, MIME-aware UI rendering, browser-use action screenshot rendering, and orchestrator screenshot payload outputs | `src/session/types.ts`, `src/ui/server.ts`, `src/engines/python-bridge.ts`, `src/orchestrator/loop.ts` |
| H-037 | US-037 | 2026-05-02 | PASS | Screenshot Persistence Sanitization | Sanitize new durable workflow result and wrap-up artifact JSON writes so screenshot base64 stays out of SQLite and wrap-up artifacts while runtime results remain usable in process | `src/workflow/types.ts`, `src/workflow/wrap-up.ts`, `src/workflow/wrap-up.test.ts` |
| H-038 | US-038 | 2026-05-02 | PASS | Screenshot Capture Policy Gate | Centralize screenshot capture decisions so UI, MCP, rolling, and workflow captures are bound, blocked, redacted, step-scoped, or treated as evidence before pixels leave the browser | `src/session/screenshot-policy.ts`, `src/session/manager.ts`, `src/ui/server.ts`, `src/mcp/server.ts`, `src/workflow/engine.ts` |
| H-039 | US-039 | 2026-05-02 | PASS | Screenshot Retention And Evidence Audit | Delete non-evidence screenshot files by retention policy, add bounded startup/wrap-up cleanup, record retryable cleanup failures, and audit evidence ids/hashes with verified deletion states | `src/session/screenshot-retention.ts`, `src/db/migrations/004_screenshot_evidence_audit.sql`, `src/session/manager.ts`, `src/workflow/wrap-up.ts` |
| H-040 | US-040 | 2026-05-03 | PASS | Deterministic Reddit Duplicate Evidence | Replace the direct Reddit duplicate-check browser-use producer with deterministic TypeScript/Playwright title collection and bounded Jaccard scoring while preserving the existing evidence contract and submit gate | `src/workflow/reddit-duplicate.ts`, `src/workflow/engine.ts`, `src/workflow/engine.test.ts` |
| H-041 | US-041 | 2026-05-03 | PASS | Screenshot Capture Scheduler And Hung-Step Guardrail | Serialize Node-side screenshot capture, collapse duplicate UI live frames, prioritize workflow evidence, and throttle rolling debug capture during hung steps while preserving the screenshot policy gate | `src/session/screenshot-scheduler.ts`, `src/session/manager.ts`, `src/session/manager.test.ts`, `src/ui/server.ts` |
| H-042 | US-042 | 2026-05-03 | PASS | Post-Task Screenshot TTL Cleanup And Recovery | Retain successful-run rolling/debug screenshots for a bounded 120 second post-task window, recover lost cleanup timers from SQLite success state on startup, and keep failed-run debug frames on the ttl_24h path | `src/session/screenshot-retention.ts`, `src/session/manager.ts`, `src/db/repository.ts`, `src/workflow/engine.ts` |
| H-043 | US-043 | 2026-05-03 | PASS | LLM Post-Action Review Evidence | Parse bounded post-action review evidence from `agent_task` output, let deterministic Reddit postconditions corroborate created-post success, and route unresolved evidence disagreement through `hitl_qa:confirm_completion` instead of a blind terminal failure | `src/workflow/types.ts`, `src/workflow/engine.ts`, `src/workflow/engine.test.ts` |
| H-044 | US-044 | 2026-05-04 | PASS | Served Runtime Lifecycle | Keep terminal reset in the workflow engine, project it through a served reset endpoint, and close served runtime resources best-effort on SIGINT/SIGTERM without requiring process restart after terminal runs | `src/workflow/engine.ts`, `src/ui/server.ts`, `src/cli/index.ts` |
| H-045 | US-045 / RF-027 | 2026-05-04 | PASS | Release Cleanup / Config | Neutralize active LLM config names, keep legacy fallback reads for one transition window, mark Stagehand-era docs as historical, and remove stale package metadata that can resurrect the wrong product story | `src/engines/browser-use/server/main.py`, `tools/config-gui/src/main.rs`, `scripts/secrets/vault-init.sh`, `README.md`, `LLM_MODEL_IMPACT.md` |
