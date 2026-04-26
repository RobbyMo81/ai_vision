# Direct Workflow Gate Layer Design

Story: `US-022`  
Tracker Row: `RF-004`  
Date: `2026-04-24`  
Status: Design artifact — no runtime code changes  

Source Atlas: `docs/architecture/as-built_execution_atlas.md`  
Source Discovery: `docs/artifacts/Discovery_mode-agentic.md`

---

## 1. Gate Contracts

### 1.1 `GateDecision`

The atomic outcome of a gate evaluation.

```typescript
type GateDecision =
  | 'run'    // Execute the step normally
  | 'skip'   // Skip the step; record reason; mark success
  | 'fail'   // Abort the step; record reason; propagate failure to the run loop
  | 'hitl'   // Pause and wait for a human gate signal before re-evaluating
  | 'retry'; // Re-evaluate the same gate after a short delay (max retries bounded)
```

**Rules:**
- A gate returns exactly one `GateDecision`.
- `skip` is not failure — the step result records `success: true` with a skip reason.
- `hitl` is not final — after the HITL signal is received, the gate re-evaluates.
- `retry` is bounded: no gate may retry more than `GATE_MAX_RETRIES` (default: 3) times before converting to `fail`.
- `fail` from a gate propagates through the normal step-failure path (`!result.success`); no special handling is needed.

---

### 1.2 `GateContext`

The read-only snapshot passed to every gate evaluator.

```typescript
interface GateContext {
  // Step identity
  stepId: string;
  stepType: WorkflowStep['type'];
  stepIndex: number;
  totalSteps: number;

  // Runtime outputs accumulated so far in this run
  outputs: Readonly<Record<string, string>>;

  // Resolved params (params + defaults + runtime outputs at this point)
  resolvedParams: Readonly<Record<string, unknown>>;

  // Session state published to UI as of this gate evaluation
  currentState: Readonly<SessionState | null>;

  // Current browser URL at gate evaluation time (empty string if unavailable)
  currentUrl: string;

  // Approval state at this point in the run
  approvalState: ApprovalState;

  // Short-term memory: scratch notes and completed fields from prior steps
  scratchNotes: readonly string[];
  completedFields: readonly string[];

  // Telemetry context for trace emission
  telemetryContext: { sessionId: string; workflowId: string };
}
```

---

### 1.3 `GateTrace`

The structured trace record emitted after every gate evaluation.

```typescript
interface GateTrace {
  gateId: string;                // e.g. 'precondition', 'approval', 'side-effect-preflight'
  stepId: string;
  decision: GateDecision;
  reason: string;                // Human-readable reason for the decision
  retryCount?: number;           // Set if decision === 'retry'
  hitlAction?: SessionState['hitlAction']; // Set if decision === 'hitl'
  durationMs: number;
}
```

All `GateTrace` records are emitted through the existing `telemetry.emit(...)` pipeline as:

```
source: 'workflow'
name: 'workflow.gate.evaluated'
details: GateTrace
```

---

### 1.4 `ApprovalState`

Represents the live approval status for the current run.

```typescript
interface ApprovalState {
  // Whether the workflow requires explicit human approval before certain steps.
  // Populated from `permissions.require_human_approval_before` in the workflow definition.
  requiredBeforeStepTypes: ReadonlySet<WorkflowStep['type']>;

  // Whether approval has been granted for the current step.
  // Starts as false. The approval gate sets it to true when HITL confirms.
  // Resets to false after the approved step executes.
  granted: boolean;

  // The step ID for which approval was granted (used for matching).
  grantedForStepId: string | null;
}
```

**Owner:** `WorkflowEngine.run(...)` creates and manages `ApprovalState` for the lifetime of the run.  
**Mutation:** Only the approval gate (`approve` HITL) and the post-step hook may mutate it.  
**Visibility:** `ApprovalState` is not projected to the UI directly; only `SessionState.hitlAction` exposes the approval surface.

---

## 2. Gate Insertion Points

The following table maps each gate to its exact insertion point in `src/workflow/engine.ts`.

| Gate ID | Insertion Point | Current Coverage | Action Required |
|---------|----------------|-----------------|-----------------|
| `precondition` | Before `executeStep(...)` call in the run loop | None — no general precondition check exists | Add |
| `approval` | Before `executeStep(...)` call in the run loop, after precondition | `permissions.require_human_approval_before` exists only in agentic path | Move to direct engine |
| `side-effect-preflight` | Inside `executeStep`, before Python/browser-use work in `agent_task` case | Partial — unresolved-var check, `outputFailsOn` check | Extend |
| `output-validation` | Inside `executeStep`, after `generate_content` and `agent_task` return | Partial — `outputFailsOn` pattern, preflight skip for `generate_content` | Extend |
| `hitl-publication` | Inside `executeStep`, before every `onStateUpdate` that changes `phase` | Ad hoc — scattered `onStateUpdate` calls | Formalize |
| `side-effect-postcheck` | Inside `executeStep`, after Python/browser-use returns from `agent_task` | Not present | Add |
| `story-sic-preflight` | In `WorkflowEngine.run(...)`, immediately before `wrapUpWorkflowRun(...)` | Not present | Add |

### 2.1 Precondition Gate

**Location:** `WorkflowEngine.run(...)` — at the top of the step loop, before the `executeStep(...)` call.

```
for (let i = 0; i < steps.length; i++) {
  const step = resolveStep(...)

  // [PRECONDITION GATE]
  const preDecision = await evaluatePreconditionGate(step, gateCtx)
  if (preDecision.decision === 'skip') { recordSkip(...); continue; }
  if (preDecision.decision === 'fail') { return failStep(...); }
  // 'run' falls through to executeStep

  const result = await executeStep(step, ...)
  ...
}
```

**Conditions evaluated:**
1. **Auth skip**: `step.type === 'human_takeover'` and auth verification signals are satisfied → `skip`
2. **URL match skip**: `step.type === 'navigate'` and `currentUrl` already matches `step.url` → `skip`  
3. **Output already present skip**: `step.type === 'generate_content'` and the required `outputKey` already exists in `outputs` → `skip`
4. **Required output missing fail**: `step.type === 'agent_task'` and a required upstream output key resolves to empty string after substitution → `fail`
5. **Default**: → `run`

**Note:** Conditions 1 and 3 currently exist as narrow inline checks inside `executeStep`. The gate layer lifts them to the loop boundary so they are consistently applied and traced.

---

### 2.2 Approval Gate

**Location:** `WorkflowEngine.run(...)` — after the precondition gate, before `executeStep(...)`.

```
// [APPROVAL GATE]
if (approvalState.requiredBeforeStepTypes.has(step.type)) {
  const approvalDecision = await evaluateApprovalGate(step, approvalState, gateCtx)
  if (approvalDecision.decision === 'hitl') {
    // publish hitl_qa / approve_step
    await hitlCoordinator.requestApproval(...)
    approvalState.granted = true
    approvalState.grantedForStepId = step.id
  }
  if (approvalDecision.decision === 'fail') { return failStep(...); }
}
```

**HITL action for approval:** `'approve_step'` (new value to be added to `SessionState.hitlAction`).

**State visibility:**
- `phase: 'hitl_qa'`, `hitlAction: 'approve_step'`
- `/api/status` returns current `SessionState` as normal — no change required
- WebSocket broadcasts the phase change through existing `hitlCoordinator.emit('phase_changed', ...)`

**Approval reset:** After `executeStep(...)` returns for the approved step, the approval gate clears `approvalState.granted = false` and `approvalState.grantedForStepId = null`.

---

### 2.3 Side-Effect Preflight Gate

**Location:** Inside `executeStep`, at the top of the `agent_task` case, after the unresolved-variable check and before `routeAgentTask(...)`.

**Conditions evaluated:**
1. **Auth state present**: The Python/browser-use worker needs an authenticated page. If the current URL signals a login page (configurable signal list in workflow YAML) → `hitl` (trigger auth verification gate)
2. **Target page valid**: If the workflow step has a declared `targetUrlPattern` field and the current URL does not match → `hitl` or `fail` (depending on `onMismatch` policy)
3. **Required fields declared**: If the step has `targets[]` that are `spi`, they must be pre-staged in short-term memory or HITL must complete them before the engine dispatches to Python → `hitl`
4. **Approval confirmed**: If `approvalState.requiredBeforeStepTypes` includes `'agent_task'`, approval must be `granted` before this boundary → `fail` if not granted

---

### 2.4 Output Validation Gate

**Location:** Inside `executeStep`, after `generate_content` writes to `outputs` and after `agent_task` returns its `taskResult`.

**Conditions evaluated:**
1. **Empty body**: `outputs[step.outputKey]` is empty string or whitespace → `fail`
2. **Placeholder body**: `outputs[step.outputKey]` contains `{{` or literal `TODO` patterns → `fail`
3. **Unresolved template in prompt**: Already covered by the existing check in `agent_task` — gate formalizes it as a traced decision rather than an inline return
4. **`outputFailsOn` pattern match**: Already covered — gate formalizes it as a `GateTrace` emission
5. **Missing title when required**: `generate_content` step has `outputTitleKey` but `outputs[step.outputTitleKey]` is empty → `fail`

---

### 2.5 HITL Publication Gate

**Location:** Centralized `onStateUpdate` replacement — a typed wrapper that validates each phase transition before publishing.

**Current problem:** `onStateUpdate(...)` accepts `Partial<SessionState>` and mutates state ad hoc. The HITL publication gate introduces a named publication contract:

```typescript
function publishStateTransition(
  next: Partial<SessionState>,
  source: string,   // 'precondition_gate' | 'approval_gate' | 'side_effect_gate' | etc.
): void
```

**Valid phase transitions (state ownership table):**

| From Phase | To Phase | Allowed Sources |
|---|---|---|
| `pre_flight` | `running` | engine main loop |
| `pre_flight` | `hitl_qa` | `bootstrapEditorialDraft`, approval gate |
| `running` | `awaiting_human` | `human_takeover` step, approval gate |
| `running` | `pii_wait` | `type` PII gate, `agent_task` sensitive targets gate |
| `running` | `hitl_qa` | `human_takeover confirm_completion`, approval gate, output validation gate |
| `running` | `complete` | engine main loop (success) |
| `running` | `error` | engine main loop (step failure) |
| `awaiting_human` | `running` | `hitlCoordinator.returnControl` |
| `pii_wait` | `running` | `hitlCoordinator.requestSensitiveValue` resolves |
| `hitl_qa` | `running` | `hitlCoordinator.requestQaPause` resolves |
| `hitl_qa` | `error` | `confirm_completion` rejected |
| `investigation` | `running` | engine main loop |

Any transition not in this table is invalid and should emit a telemetry warning rather than silently proceeding.

---

### 2.6 Side-Effect Postcheck Gate

**Location:** Inside `executeStep`, immediately after `engine.runTask(...)` returns in the `agent_task` case.

**Conditions evaluated:**
1. **Browser URL advanced**: If the step had a declared `expectedUrlAfter` field and the post-task URL does not match → emit warning trace (not fail — side effects may not always change URL)
2. **Catastrophic navigation**: If post-task URL is `chrome://` or `about:blank` → `fail`
3. **Success evidence present**: If the step has `successEvidence` text patterns declared in YAML, at least one must appear in `taskResult.output` → if absent: `hitl` (for manual verification) rather than silent success

---

### 2.7 Story/SIC Preflight Gate

**Location:** In `WorkflowEngine.run(...)`, immediately before `wrapUpWorkflowRun(...)`.

**Conditions evaluated:**
1. **HITL QA notes**: If `process.env.AI_VISION_UI_PORT` is set and the run failed, this gate already exists as the post-failure QA pause. The gate layer formalizes it.
2. **SIC trigger classification**: If a final-confirmation rejection was recorded (`hitlFailureReason` is set), the gate ensures `buildSicTrigger(...)` receives the rejection reason before wrap-up.
3. **Operator notes capture**: On success for recurring portal workflows with `authVerification`, optionally publish a `hitl_qa / capture_notes` pause to capture learnings before the run closes.

---

## 3. State Ownership Table

| State Surface | Owner | Projection Path | Notes |
|---|---|---|---|
| `WorkflowEngine._currentState` | `WorkflowEngine.run(...)` | → `onStateUpdate` → `_currentState` | Single write path inside the engine |
| `hitlCoordinator.phase` | `HitlCoordinator` | → emits `phase_changed` event | Must stay in sync with `_currentState.phase` |
| `/api/status` response | `ui/server.ts` | reads `workflowEngine.currentState` | No independent state — always a projection of engine state |
| WebSocket broadcast | `ui/server.ts` | receives `hitlCoordinator.on('phase_changed', ...)` | Fires on every phase change; client receives full `SessionState` snapshot |
| MCP `session_status` | `mcp/server.ts` | reads `workflowEngine.currentState` | Same projection as `/api/status` |

**Canonical state publication rule:**  
`WorkflowEngine._currentState` is the single source of truth. All other state surfaces are read projections.  
`HitlCoordinator.phase` must never advance independently of `_currentState.phase` — the engine must call both in the same synchronous update path.

**Current gap:** `hitlCoordinator.setPhase(...)` is called in places independent of `onStateUpdate(...)`. The gate layer closes this by routing all phase transitions through `publishStateTransition(...)`, which calls both `onStateUpdate` and `hitlCoordinator.setPhase` atomically.

---

## 4. Approval and Side-Effect Blocking Model

### 4.1 Approval Enforcement

**Source field:** `permissions.require_human_approval_before` in `WorkflowDefinition`.

**Current type:**
```typescript
interface WorkflowPermissions {
  require_human_approval_before?: ('agent_task' | 'human_takeover' | 'generate_content')[];
}
```

**Extension needed:** Add `'approve_step'` to `SessionState.hitlAction` union.

**Enforcement sequence:**

```
1. Engine reads permissions.require_human_approval_before once at run start → approvalState.requiredBeforeStepTypes
2. Before each step: approval gate checks if step.type ∈ requiredBeforeStepTypes
3. If yes and !approvalState.granted:
     a. publishStateTransition({ phase: 'hitl_qa', hitlAction: 'approve_step', ... })
     b. await hitlCoordinator.requestApproval(...)
     c. approvalState.granted = true
4. executeStep proceeds
5. After executeStep: approvalState.granted = false (consumed for this step only)
```

This replaces the agentic loop's `require_human_approval_before` implementation in `src/orchestrator/loop.ts`.

---

### 4.2 Side-Effect Blocking Before Irreversible Mutations

**Irreversible mutation boundary:** The Python/browser-use `engine.runTask(...)` call inside `agent_task`.

Before that call, the side-effect preflight gate must confirm:

| Check | Gate Decision on Failure |
|---|---|
| Auth is confirmed or auth verification passed | `hitl` → re-run auth verification |
| Approval granted (if required) | `fail` — not a runtime pause; a policy violation |
| No unresolved `{{placeholders}}` in prompt | `fail` |
| No SPI fields left unhandled | `hitl` → pause for HITL sensitive-field entry |
| `outputFailsOn` check on prior step output if a chain dependency exists | `fail` |

**Nothing from `agent_task` may proceed to `engine.runTask(...)` if any of these checks returns a blocking decision.**

---

## 5. Direct-Path Replacements for Agentic Flexibility

| Agentic Behavior | Direct-Path Replacement | Gate Layer |
|---|---|---|
| `permissions.require_human_approval_before` enforced in Claude loop | Approval gate in run loop before `executeStep` | `approval` |
| Auth verification decided by Claude planner | `isAuthVerificationSatisfied(...)` extended as the precondition gate `auth-skip` | `precondition` |
| Placeholder draft generation in tool boundary | `generate_content` step with `output-validation` gate; no placeholder strings | `output-validation` |
| Redundant login steps skipped by Claude judgment | Precondition gate: URL match or auth signals already satisfied | `precondition` |
| Redundant content generation skipped | Precondition gate: `outputKey` already in `outputs` | `precondition` |
| HITL pause as generic blind tool call | Typed `hitlAction` values with canonical phase transitions | `hitl-publication` |
| Post-publish success check by Claude | `successEvidence` field + `side-effect-postcheck` gate | `side-effect-postcheck` |

---

## 6. Gate Decision Trace Events

All gate decisions emit a single telemetry event using the existing pipeline:

```typescript
telemetry.emit({
  source: 'workflow',
  name: 'workflow.gate.evaluated',
  sessionId: ctx.telemetryContext.sessionId,
  workflowId: ctx.telemetryContext.workflowId,
  stepId: ctx.stepId,
  details: {
    gateId: string,
    decision: GateDecision,
    reason: string,
    retryCount?: number,
    durationMs: number,
  },
});
```

No new telemetry infrastructure is needed — `workflow.gate.evaluated` is a new event name on the existing pipeline.

---

## 7. Minimum Test Matrix Before `mode: agentic` Can Be Retired

The following test coverage must exist and pass in `src/workflow/engine.test.ts` before `mode: agentic` is removed from the codebase.

### 7.1 Precondition Gate Tests

| Test | Assertion |
|---|---|
| Navigate step: URL already matches | Decision = `skip`; step result has `success: true`; no `sessionManager.navigate()` called |
| Auth step: auth signals already satisfied | Decision = `skip`; no HITL pause emitted |
| Auth step: auth signals not satisfied | Decision = `run`; HITL pause emitted |
| Generate content: outputKey already in outputs | Decision = `skip`; `getGeminiWriter()` not called |
| Agent task: unresolved `{{placeholder}}` | Decision = `fail`; `engine.runTask()` not called |

### 7.2 Approval Gate Tests

| Test | Assertion |
|---|---|
| Step type in `require_human_approval_before` | `hitl_qa` phase emitted before step executes |
| Step type not in `require_human_approval_before` | No approval pause |
| Approval granted on first request | Step proceeds; `approvalState.granted` resets after step |
| Second step after approval reset | Second step requires its own approval if also in the required list |

### 7.3 Side-Effect Preflight Gate Tests

| Test | Assertion |
|---|---|
| `agent_task` with unresolved placeholder | `fail` before `engine.runTask()` |
| `agent_task` with SPI targets, no pre-staged value | `hitl` pause for PII input before `engine.runTask()` |
| `agent_task` on login URL with no auth | `hitl` pause for auth verification before `engine.runTask()` |

### 7.4 Output Validation Gate Tests

| Test | Assertion |
|---|---|
| `generate_content` produces empty body | `fail`; downstream agent_task not reached |
| `generate_content` produces `{{placeholder}}` body | `fail`; downstream agent_task not reached |
| `agent_task` output matches `outputFailsOn` | `fail`; result classified as `duplicate_rejected` |
| Valid content passes | Decision = `run`; pipeline continues |

### 7.5 HITL Publication Tests

| Test | Assertion |
|---|---|
| `_currentState.phase` and `hitlCoordinator.phase` stay in sync on every transition | Both report the same phase after each `publishStateTransition` call |
| WebSocket broadcast fires on every phase change | `ws.send()` called once per phase transition |
| `/api/status` returns current phase | Returns projection of `_currentState` at call time |

### 7.6 Browser Side-Effect Blocking Tests

| Test | Assertion |
|---|---|
| `agent_task` with `targetUrlPattern` mismatch | Gate fires; `engine.runTask()` blocked until URL matches or HITL advances |
| `agent_task` on `chrome://newtab` URL | `side-effect-preflight` gate returns `hitl` |
| `confirm_completion` rejection | `hitlFailureReason` set; SIC trigger includes the reason; result is `fail` |

### 7.7 `mode: agentic` Quarantine Preconditions

`mode: agentic` may only be quarantined (branch removed) after:

1. All tests in sections 7.1–7.6 pass.
2. `workflows/authenticated_task.yaml` and `workflows/write_and_post_to_reddit.yaml` are rewritten to use direct-path step semantics (no `mode: agentic`).
3. One successful end-to-end run of `write_and_post_to_reddit` completes via the direct engine with the approval and side-effect gates active.
4. `src/orchestrator/loop.ts` is quarantined behind a dead-code comment block (not deleted until the next story confirms no regression).

---

## 8. New YAML Fields Required

The following fields must be added to `WorkflowStep` types in `src/workflow/types.ts` to support the gate layer:

| Field | Step Type | Purpose |
|---|---|---|
| `targetUrlPattern` | `agent_task` | Regex or fragment: current URL must match before dispatch |
| `onUrlMismatch` | `agent_task` | `'hitl' \| 'fail'` — what to do if URL doesn't match (default: `'hitl'`) |
| `successEvidence` | `agent_task` | String patterns that must appear in output for the step to be treated as succeeded |
| `expectedUrlAfter` | `agent_task` | URL fragment expected after the task completes (postcheck gate) |

These are additive — no existing fields change meaning or are removed.

`SessionState.hitlAction` union must be extended with `'approve_step'`.

---

## 9. Design Constraints Preserved

| Constraint | Status |
|---|---|
| TypeScript remains the workflow kernel | Preserved — gate layer is TypeScript-only |
| Python remains the bounded intelligence/browser-worker layer | Preserved — Python is only touched at the `engine.runTask()` boundary |
| Rust is out of scope | Preserved — not referenced |
| `mode: agentic` is not removed in this story | Preserved — design only, no code changes |
| `src/workflow/wrap-up.ts` owns session teardown | Preserved — story/SIC preflight gate calls into wrap-up, not around it |
| Telemetry via `telemetry.emit(...)` only | Preserved — all new gate traces use the existing pipeline |
