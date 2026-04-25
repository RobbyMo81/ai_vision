# Discovery: `mode: agentic` Shape, Layers, and Path

Date: 2026-04-24

## A. Executive Summary

`mode: agentic` is not just a workflow flag. In this codebase it is the switch that routes YAML workflows away from the direct step executor and into `src/orchestrator/loop.ts`, where Claude gets a second reasoning layer, a different approval path, placeholder content generation, and a distinct HITL publication pattern.

The direct workflow engine already has several deterministic gates:

- PII gating on `type`
- auth verification on `human_takeover`
- step output failure checks on `agent_task`
- content preflight bootstrap / skip logic for social workflows
- final confirmation and failed-run QA pauses

But the direct engine does **not** yet have a generalized gating layer for:

- approval permissions from YAML
- precondition-based step skipping beyond auth verification
- structured browser/page validation before and after side-effect steps
- a neutral approval state for generic human gates
- explicit branch/skip classification for redundant or nonsensical steps

The current production issue is therefore not “direct vs. agentic” in the abstract. It is that the direct engine has not yet absorbed the useful parts of agentic flexibility into explicit deterministic gates.

**Recommendation: NO-GO for deleting `mode: agentic` immediately.**  
**GO only after the direct engine gains explicit gates for approval, validation, and branch/skip decisions, and the agentic workflows are rewritten to use them.**

---

## B. Current Direct-Path Execution Shape

### Top-level flow

The direct workflow path lives in `src/workflow/engine.ts`.

The current run shape is:

1. Resolve params and defaults
2. Resolve workflow steps against runtime outputs
3. Start the session / browser / screenshot timer
4. Seed short-term memory and long-term improvements
5. Run preflight correlation
6. Bootstrap social editorial content when applicable
7. Optionally enter investigation mode for bespoke runs
8. Iterate step-by-step through `executeStep(...)`
9. Handle failure or completion
10. Run wrap-up, story write, and SIC trigger persistence

The direct dispatch switch is inside `executeStep(...)`.

### Step dispatch

Current direct-compatible step types:

- `navigate`
- `click`
- `type`
- `fill`
- `screenshot`
- `extract`
- `agent_task`
- `human_takeover`
- `generate_content`

### Where skip / continue / branch already exists

There are only a few actual decision points today:

- `navigate`
  - verifies the browser landed somewhere real, not `chrome://` or `about:blank`
  - does not branch, but it does fail fast if navigation is bogus
- `type`
  - has deterministic PII gating
  - may pause for secure HITL input before typing
- `agent_task`
  - routes to an engine via `routeAgentTask(...)`
  - can fail fast on unresolved template variables
  - can fail fast if `outputFailsOn` matches the agent output
  - can pause for sensitive field handling via `targets`
- `human_takeover`
  - can skip login HITL when `authVerification` signals are already satisfied
  - can pause for login / manual intervention / final confirmation
- `generate_content`
  - can skip GeminiWriter if the outputs already exist from preflight
  - can pause for draft approval in the social bootstrap path

### Where nonsensical or redundant steps are currently forced to run

There is no general-purpose `skipIf`, `branchIf`, or `precondition` system in the direct executor.

That means any step the workflow author writes will run unless one of the narrow existing gates triggers. In practice:

- redundant login steps are only skipped if `authVerification` exists and passes
- redundant content generation is only skipped in the social bootstrap path when outputs already exist
- side-effect browser steps are not structurally blocked unless a workflow author explicitly placed a `human_takeover` gate before them

There is no engine-level notion of:

- “already authenticated, so skip this step”
- “draft is already filled correctly, so skip this browser task”
- “this publish step requires approval and must wait”
- “this step is irrelevant for the current page state, so branch around it”

### Direct execution lifecycle state

The direct engine publishes:

- `pre_flight`
- `investigation`
- `running`
- `awaiting_human`
- `pii_wait`
- `hitl_qa`
- `complete`
- `error`

It uses `onStateUpdate(...)` to mutate `workflowEngine.currentState`, and that is the state object the UI status endpoint reads.

---

## C. Current Agentic-Only Behavior That Must Be Replaced

`mode: agentic` is the gate that routes YAML workflows into the Claude orchestrator loop.

Current agentic-specific behavior:

- `src/workflow/engine.ts` branches to `runOrchestratorLoop(...)` when YAML workflows have `mode: 'agentic'`
- `src/orchestrator/loop.ts` builds a Claude system prompt from markdown instructions plus memory context
- the orchestrator owns its own `ORCHESTRATOR_TOOLS`
- `permissions.require_human_approval_before` is enforced there today
- `human_takeover` is implemented as a generic blind pause in the tool loop
- `generate_content` returns placeholder strings in the tool boundary instead of using the direct editor/content bootstrap semantics
- the loop uses `complete_workflow` as its termination signal

This layer is exactly where the production Reddit trace showed semantic drift:

- auth verification became a planning decision instead of a deterministic gate
- approval became a tool-loop pause instead of a direct engine contract
- content generation was weakened to placeholder output / downstream prompt propagation
- browser-use reliability and HITL state publication lost parity with the direct path

### Agentic-only items to quarantine or delete

If `mode: agentic` is removed as a production execution mode, the following are the agentic-only seams:

- `src/orchestrator/loop.ts`
- `src/orchestrator/loop.test.ts`
- the `mode: agentic` branch in `src/workflow/engine.ts`
- YAML workflows that explicitly depend on the orchestrator path:
  - `workflows/authenticated_task.yaml`
  - `workflows/write_and_post_to_reddit.yaml`
- docs/artifacts that describe the orchestrator split:
  - `docs/artifacts/claude-layer-shape-connects.md`
  - `docs/artifacts/2026-04-24-reddit-production-run-bug-trace.md`

Important nuance:

- `src/orchestrator/loader.ts` is **not** fully orphaned
- `loadYamlWorkflow(...)` and `listYamlWorkflows(...)` still matter for CLI workflow loading and discovery
- `loadAllInstructions(...)` is the orchestrator-only helper that becomes dead if the agentic loop is removed

---

## D. Proposed Direct-Path Gates

This is the replacement surface that should absorb the useful parts of `mode: agentic`.

### 1. Precondition gate

Goal:

- decide whether a step should run at all
- skip redundant steps without invoking a hidden LLM planner

Best fit in the direct engine:

- right before `executeStep(...)`

Useful preconditions:

- current URL already matches the target URL
- authenticated state already satisfies login verification
- draft / body / title already matches expected output
- a required output already exists from runtime substitution

### 2. Auth verification gate

Current direct behavior already supports this through `human_takeover.authVerification`.

This should be generalized into a direct-path gate because it already expresses the right model:

- authenticated -> skip login HITL
- unauthenticated -> request login HITL
- uncertain -> request human verification

Current source:

- `isAuthVerificationSatisfied(...)`
- `human_takeover` branch in `executeStep(...)`

### 3. Approval gate

`permissions.require_human_approval_before` is currently agentic-only.

Discovery recommendation:

- keep the field
- move enforcement into the direct engine
- publish `hitl_qa` before blocking

This should belong at the direct step boundary, before the step executes.

If the UI state model is not extended, the current enum is awkward:

- `approve_draft` is close for publishing workflows
- `confirm_completion` is correct for irreversible final actions
- a generic `approve_step` action would be cleaner, but does not exist yet

### 4. Content/output gate

Current direct content path:

- `bootstrapEditorialDraft(...)`
- `generate_content` step dispatch

Gates that should exist in the direct path:

- empty content
- placeholder content
- content that is clearly unrelated to the workflow / platform
- missing title/body where the workflow expects both
- downstream substitution failure when a later step consumes a missing output

The engine already has some output safety:

- runtime placeholder preservation
- unresolved placeholder failure for `agent_task`
- `outputFailsOn` for duplicate checks

It does **not** yet validate generated content quality beyond presence.

### 5. Browser / submit gate

Current browser automation is mostly prompt-driven once a step becomes `agent_task`.

The direct engine should own explicit side-effect gates for:

- expected URL before acting
- expected page / DOM state before drafting
- required fields exist before filling
- draft content equals expected content before submit
- submit action is blocked until approval is published

At present, these behaviors live mostly in:

- workflow text prompts
- browser-use heuristics
- narrow `authVerification`

That is not strong enough for production without the agentic overlay.

### 6. Failure classification / story / SIC gate

The replacement for “agentic flexibility” should end in explicit outcome handling:

- classify the failure
- write the story
- persist wrap-up state
- emit SIC trigger candidates when the run has operator evidence

This already exists in the app:

- `classifySocialOutcome(...)`
- `wrapUpWorkflowRun(...)`
- `buildStory(...)`
- `buildSicTrigger(...)`
- `longTermMemory.writeStory(...)`
- `forgeSicStore.saveSicTrigger(...)`

So the direct engine can become stricter without losing learning behavior.

---

## E. File / Function Impact Map

### Core workflow engine

`src/workflow/engine.ts`

Keep / extend:

- direct step dispatch in `executeStep(...)`
- `isAuthVerificationSatisfied(...)`
- `bootstrapEditorialDraft(...)`
- `classifySocialOutcome(...)`
- `wrapUpWorkflowRun(...)`
- `buildStory(...)`

Remove or refactor:

- the `mode: agentic` branch that imports `runOrchestratorLoop(...)`

### Workflow schema

`src/workflow/types.ts`

Keep:

- `human_takeover.authVerification`
- `generate_content`
- `agent_task`
- `WorkflowPermissionsSchema`

Change:

- `mode: 'direct' | 'agentic'` should become deprecated or removed once direct gates cover the use cases

### Orchestrator layer

`src/orchestrator/loop.ts`

Candidate for quarantine/deletion once direct gates absorb its useful behavior:

- tool-calling loop
- `ORCHESTRATOR_TOOLS`
- `loadAllInstructions(...)`
- `permissions.require_human_approval_before` enforcement in the loop

### Loader

`src/orchestrator/loader.ts`

Keep:

- `loadYamlWorkflow(...)`
- `loadWorkflowByName(...)`
- `listYamlWorkflows(...)`

Delete or isolate:

- `loadAllInstructions(...)` if the orchestrator loop is removed

### HITL and UI

`src/session/hitl.ts`
`src/ui/server.ts`

Keep:

- HITL blocking primitives
- WebSocket publication
- `/api/status`
- `/api/confirm-final-step`
- `/api/acknowledge`
- `/api/pii-input`

Potential improvement:

- unify the public HITL state projection so there is one clear state owner

### Wrap-up / memory

`src/workflow/wrap-up.ts`
`src/memory/types.ts`
`src/memory/long-term.ts`
`src/memory/forge-sic.ts`

Keep:

- story creation
- SIC trigger persistence
- operator note capture
- session metadata persistence

These already provide the story/SIC path that should replace the hidden agentic reasoning layer.

### Workflow files

Convert or replace:

- `workflows/authenticated_task.yaml`
- `workflows/write_and_post_to_reddit.yaml`

These are the current explicit `mode: agentic` users.

### Tests

Update:

- `src/workflow/engine.test.ts`
- `src/orchestrator/loop.test.ts`

Add:

- direct gate tests for auth verification, approval, content validation, and skip behavior

Potentially add:

- a UI state publication test file, because there is currently no dedicated `src/ui/server.test.ts`

---

## F. Test Impact Map

### Existing tests already cover

`src/workflow/engine.test.ts`

- runtime substitution
- step array stability
- social content bootstrap skip / handoff behavior
- `mode: agentic` delegation to `runOrchestratorLoop(...)`

`src/orchestrator/loop.test.ts`

- instructions and memory bank loading
- `complete_workflow`
- `permissions.require_human_approval_before`
- max-iteration failure
- Anthropic failure
- browser-use live event handling

### Missing tests for the direct-gate migration

Minimum direct-path coverage needed:

- authenticated Reddit submit page skips login HITL
- unauthenticated Reddit page requests login HITL
- every HITL wait publishes visible UI action state
- draft approval appears after composer fill
- submission cannot occur before approval
- generated content must use ai-vision context or fail the gate
- placeholder content fails fast
- direct gate can skip unnecessary step
- `agent_task` cannot bypass side-effect gates

### Test files likely to change

- `src/workflow/engine.test.ts`
- new `src/ui/server.test.ts` or equivalent UI state test coverage
- `src/orchestrator/loop.test.ts` if the agentic loop is quarantined or deleted

### Notable current gap

The UI/server interaction surface currently has no dedicated test file in `src/`. That matters because the direct-path migration depends heavily on visible state publication.

---

## G. Risks and Tradeoffs

### Risks of removing `mode: agentic` too early

- hidden approval semantics disappear before direct gates replace them
- social drafting regressions reappear as brittle prompt-driven browser steps
- login HITL can become noisy again if auth verification is not generalized
- UI status can diverge from actual wait state if state publication is not unified

### Risks of keeping `mode: agentic`

- split semantics between direct and orchestrated workflows remain
- direct path and orchestrator path keep drifting apart
- browser-use / approval / content behavior becomes harder to reason about
- production traceability suffers because step intent is split across two execution models

### Tradeoff to accept

The system should be more deterministic, but not more rigid.

That means:

- keep explicit gates
- keep browser-use for the hard work
- keep story/SIC capture
- remove the hidden outer planner

### Canonical state ownership risk

`workflowEngine.currentState` is the public state projection that `/api/status` and the UI already read.

`hitlCoordinator` owns the blocking primitives and internal wait state.

If these diverge, the UI can show stale or missing action buttons.

The migration should avoid introducing a second public state owner.

---

## H. Recommended Implementation Sequence

1. Add direct-path gate helpers in `src/workflow/engine.ts`
   - auth verification
   - approval gate
   - browser page / content validation
   - skip logic for redundant steps

2. Wire `permissions.require_human_approval_before` into the direct step loop
   - do this before `executeStep(...)`
   - publish HITL state before waiting

3. Generalize `authVerification` as the direct login gate
   - keep the current skip behavior
   - make the state publication consistent for both skip and wait paths

4. Add content validation for `generate_content`
   - empty output
   - placeholder output
   - missing title/body
   - downstream substitution sanity

5. Add browser-side validation gates around publish / submit steps
   - expected page
   - expected fields
   - approval-required submit boundaries

6. Convert the agentic YAML workflows to direct workflows
   - `workflows/authenticated_task.yaml`
   - `workflows/write_and_post_to_reddit.yaml`

7. Add or update tests
   - direct gate tests first
   - UI publication tests next
   - orchestrator tests last

8. Quarantine or delete `src/orchestrator/loop.ts`
   - only after the direct gates are proven

9. Remove `mode: agentic`
   - only after the workflows no longer need the outer planner

---

## I. GO / NO-GO Recommendation

**NO-GO for removing `mode: agentic` right now.**

Reason:

- the direct engine does not yet have a full replacement for the useful agentic behaviors
- the approval permission metadata is still agentic-only
- the browser and content validation gates are not yet generic enough
- the visible HITL state publication should be proven before the outer planner is removed

**Conditional GO** once the following are true:

- direct engine enforces permissions approval
- auth verification is fully generalized in the direct path
- content and browser side-effect gates are explicit
- skip decisions are deterministic and visible
- tests cover the new gates
- the agentic workflows have been converted or retired

