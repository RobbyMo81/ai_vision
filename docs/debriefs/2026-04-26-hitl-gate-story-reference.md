# HITL Gate Story Quick Reference

Date: `2026-04-26`

Purpose: quick operator reference for the HITL/direct-gate implementation track after `US-024`.

## Current Position

The atlas direction is active but not finished.

Completed:

- `US-022` / `RF-004` — Direct workflow gate layer design
- `US-023` / `RF-005` — Phase 1 HITL state publication
- `US-024` / `RF-006` — Phase 2 final-step confirmation pre-flight binding enforcement
- `US-025` / `RF-007` — Phase 3 return-control pre-flight binding enforcement
- `US-026` / `RF-008` — Phase 4 approval gate before browser side effects
- `US-027` / `RF-009` — Phase 5 content/output validation gate
- `US-028` / `RF-010` — Phase 6 Reddit duplicate-check deterministic evidence gate
- `US-029` / `RF-011` — Phase 7 browser side-effect/postcondition gate
- `US-030` / `RF-012` — Phase 8 generalized precondition/skip gate
- `US-031` / `RF-013` — Phase 9 `agent_task` side-effect safety gate
- `US-032` / `RF-014` — Phase 10 `agent_task` dominant intent classification fix

Not yet complete:

- `mode: agentic` must remain present until direct-path gates and tests cover the atlas retirement matrix.

## Created Stories

| Story | Status | Why It Exists | Completion State | Done Requirement |
|---|---|---|---|---|
| `US-022` / `RF-004` | Complete | Define the direct workflow gate layer before implementation. | Done. Design package exists and PRD/tracker mark it passed. | Gate contracts, insertion points, HITL ownership model, approval/side-effect policy, content validation rules, and test matrix are documented while preserving `mode: agentic`. |
| `US-023` / `RF-005` | Complete | Make every direct HITL wait visible through one canonical public state path. | Done. `workflowEngine.currentState` is canonical public projection and `hitlCoordinator` remains blocking-wait owner. | Direct waits and terminal states publish through the canonical helper; `/api/status` and websocket state converge; tests pass. |
| `US-024` / `RF-006` | Complete | Prevent stale-tab and session-mismatched final confirmations from reaching the HITL completion path. | Done. `/api/confirm-final-step` has run-phase, session-binding, and WebSocket-presence gates. `/api/return-control` has trace parity only. | Three confirmation gates reject with `409`, `400`, `403`; rejection telemetry is emitted; active-tab happy path still works; `/api/return-control` emits attribution telemetry; tests pass. |
| `US-025` / `RF-007` | Complete | Prevent stale-tab, session-mismatched, and invalid-action return-control resumes from reaching the HITL resume path. | Done. `/api/return-control` has action-state, session-binding, and WebSocket-presence gates. | Return-control rejects with `409`, `400`, `403`; rejection and completed telemetry are emitted; active-tab happy paths still work; production HITL test passed. |
| `US-026` / `RF-008` | Complete | Require explicit human approval before protected browser side effects. | Done. Direct workflow approval gate pauses with `hitl_qa:approve_step` and resumes through bound return-control. | Protected steps cannot execute before approval; approval is run-scoped and consumed after execution; tests pass. |
| `US-027` / `RF-009` | Complete | Reject invalid generated and substituted output before browser posting. | Done. Direct content/output validation blocks empty, placeholder, unresolved, missing, and generic values. | Invalid generated output and unresolved downstream placeholders fail before side effects; telemetry and tests pass. |
| `US-028` / `RF-010` | Complete | Require deterministic Reddit duplicate-check evidence before submit. | Done. Reddit duplicate evidence is parsed and submit is gated by extracted titles, overlap scores, and no-duplicate decision. | Missing, invalid, contradictory, and duplicate-risk evidence blocks submit; tests pass. |
| `US-029` / `RF-011` | Complete | Validate browser side-effect outcomes before downstream confirmation. | Done. Browser postconditions validate expected URL and required output evidence after side-effect execution. | False-success Reddit submit and draft mismatch paths are blocked; telemetry and tests pass. |
| `US-030` / `RF-012` | Complete | Lift scattered skip logic into one traceable direct precondition gate. | Done. Direct precondition gate runs before approval and `executeStep(...)`. | Direct precondition gate skips authenticated login, existing generated output, and already-matching navigation while tracing run/skip/fail/HITL decisions; tests pass. |
| `US-031` / `RF-013` | Complete | Prevent prompt-driven `agent_task` execution from bypassing the direct gate stack. | Done. Safety gate classifies `agent_task` prompts before worker dispatch. | `agent_task` side-effect intent is classified before worker dispatch; protected prompts cannot bypass approval, content, duplicate-evidence, precondition, and browser postcondition gates; tests pass. |
| `US-032` / `RF-014` | Complete | Fix dominant-intent drift found during US-031 production-run pre-flight. | Done. Classifier collects matched signals and selects dominant workflow intent. | Live `post_to_reddit.yaml` `submit_reddit_post` prompt classifies as `submit`, fallback fill text does not override submit, standalone fill/login/read-only behavior remains correct, and tests pass. |
| `US-033` / `RF-015` | Complete | Fix the second live-prompt drift where `check_duplicate_reddit_post` can be blocked before it creates duplicate evidence. | Done. Exact live prompt fixtures cover duplicate-check and submit behavior, and the duplicate-check evidence producer is allowed through a narrow deterministic read-only contract. | Exact live duplicate-check and submit prompts are regression fixtures; duplicate-check can produce evidence before submit gating requires it; submit remains blocked until valid no-duplicate evidence exists; tests pass. |

## Created But Not Complete Backlog Stories

These exist in `prd.json` with `passes: false`, but they are not the active HITL/direct-gate sequence.

| Story | Status | Why Not Completed | Done Requirement |
|---|---|---|---|
| `US-012` — browser-use live event bridge | Incomplete | Older browser-use telemetry story remains marked false in PRD. Later work added browser-use action telemetry, but this story has not been reconciled against its original acceptance criteria. | Python bridge posts browser-use action events to the callback URL; Node bridge emits telemetry; UI forwards events in real time; orchestrator receives mid-task state; typecheck and tests pass. |
| `US-020` — TSC crash diagnostic classification baseline | Incomplete | Older diagnostic/investigation story remains marked false. It is not required for the HITL gate sequence unless TypeScript crashes recur. | Produce the bug report and YAML refactoring artifact with runtime baseline, Node 24 comparison, OS/Node/TypeScript layer evidence, metrics, and procedures. |
| `US-021` — TSC crash layered remediation protocol | Incomplete | Older remediation-protocol story remains marked false. It depends on the diagnostic path and is not blocking the HITL gate sequence right now. | Produce the remediation report and YAML story artifact that classify the active failure layer and define remediation procedures. |

## Atlas-Aligned Stories Still Needed

No additional atlas-aligned story is currently seeded in this reference after `US-033`.

## Approved Implementation Sequence

The approved sequence is:

1. `US-027` / `RF-009` — Content/output validation gate
2. `US-028` / `RF-010` — Reddit duplicate-check deterministic evidence gate
3. `US-029` / `RF-011` — Browser side-effect/postcondition gate
4. `US-030` / `RF-012` — Generalized precondition/skip gate
5. `US-031` / `RF-013` — `agent_task` side-effect safety gate

Batching rule:

- `US-027` and `US-028` are data-integrity gates.
- `US-029`, `US-030`, and `US-031` are execution-safety gates.
- Do not combine all five into one mega-story. Each item must remain independently testable.

## Production Hardening Workflow Candidates

These candidates come from supervised live runs and should be converted into Forge stories only after the next story sequence is confirmed.

| Candidate | Source Evidence | Problem | Required Done State |
|---|---|---|---|
| Reddit duplicate-check deterministic evidence gate | `post_to_reddit` session `f378ab06-8636-4171-a32e-8a772af23e1e`; post URL `https://www.reddit.com/r/test/comments/1sxm1nu/aivision_workflow_update_hitl_approval_gates_are/`; browser-use judge warning on duplicate check | The workflow submitted successfully, but the duplicate-check step relied on browser-use narrative judgment instead of a deterministic list of extracted visible titles plus overlap scores. | Before any Reddit submit step, the engine must have duplicate-check evidence containing extracted visible titles, computed similarity scores, and a pass/fail decision. Missing evidence blocks submit and publishes a visible HITL or failure state. |

## HITL Operator Rule

For a HITL story to be considered done:

- The operator-visible state must publish before a blocking wait.
- The endpoint that resumes the wait must verify the active run context before resolving the coordinator.
- The endpoint must emit structured rejection telemetry when it refuses to resume.
- The active-tab happy path must remain tested.
- `workflowEngine.currentState` stays the public projection.
- `hitlCoordinator` stays the blocking-wait owner.
- `mode: agentic` remains present until the full direct-gate retirement matrix is implemented and tested.

## Current Recommendation

Current gate-track recommendation:

```text
Keep `mode: agentic` in place and treat exact live workflow prompts as first-class safety contracts for future direct-path gate stories.
```

Reason: `US-033` is now implemented. The remaining governance constraint in this reference is the broader retirement matrix for `mode: agentic`, not the duplicate-check prompt contract gap.

## Backlog Relevance Investigation Storyline

Storyline type: debrief-only investigation.

Scope: investigate only the created-but-incomplete backlog stories to determine whether they are still relevant sprints.

Backlog stories in scope:

- `US-012` — browser-use live event bridge
- `US-020` — TSC crash diagnostic classification baseline
- `US-021` — TSC crash layered remediation protocol

### Mission

Determine whether each backlog story should remain an active sprint candidate, be revised, be superseded by later work, be deferred, or be canceled.

This is not an implementation story.

### Explicit Instructions

- Do not implement backlog story code.
- Do not change `passes` values in `prd.json` unless the investigation proves the existing acceptance criteria are already satisfied by current code and tests.
- Do not create a new Forge implementation package during this investigation.
- Do not interrupt the active atlas-aligned HITL gate path unless the investigation finds a backlog story that is a direct blocker for `US-025`.
- Use the current repository state as evidence, not assumptions.
- For each backlog story, inspect:
  - `prd.json`
  - `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
  - `progress.txt`
  - `docs/history/forge_history.md`
  - related source files and tests
  - related debriefs under `docs/debriefs/`
- Classify each story as exactly one of:
  - `complete-with-evidence`
  - `still-relevant`
  - `revise`
  - `superseded`
  - `defer`
  - `cancel`

### Required Output

Save the investigation as a new debrief under `docs/debriefs/` with a date-prefixed filename.

The debrief must include:

- story ID and title
- current PRD status
- evidence reviewed
- relevance decision
- reason for the decision
- whether it blocks `US-025`
- required next action
- required definition of done if the story remains relevant

### Definition Of Done

The backlog relevance investigation is done when:

- `US-012`, `US-020`, and `US-021` each have a documented relevance classification
- every classification is backed by file, test, or history evidence
- the debrief states whether any backlog story blocks `US-025`
- no implementation code is changed
- no unrelated governance status is changed
- `progress.txt` records the debrief summary
