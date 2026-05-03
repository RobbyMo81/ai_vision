# Screenshot Workflow Investigation Scratch Pad

Date: 2026-05-01
Status: Working scratch pad
Purpose: Track the branching screenshot workflow investigation before it is promoted into one or more Forge stories.

## Investigation Question

The screenshot subsystem has multiple producers, transports, and durable storage paths. The active question is whether the current behavior creates security, privacy, storage, and operator-observability risk, and which branches need governed hardening.

## Current Working Conclusion

Screenshots should not be treated as neutral runtime artifacts. They can contain sensitive page data and currently flow through both live/session-only paths and durable persistence paths without a screenshot-specific policy layer.

The likely target model is:

- live screenshots are ephemeral by default
- durable screenshots are opt-in evidence artifacts
- workflow screenshot retention is strict opt-in and fail-closed when evidence-purpose metadata is missing
- screenshot base64 is not persisted by default
- sensitive phases block or restrict screenshot capture
- every screenshot crossing a boundary carries source, MIME type, sensitivity, and retention metadata

## Operational Recommendation

Proceed with the strict opt-in model already established in the screenshot policy docs.

Retention recommendation:

- do not invent a `SIC TTL` inside the current sprint
- for SIC-style review, use the existing `keep_until_manual_review` retention mode landed by `US-035` / `RF-017`
- treat storage management for retained evidence as a manual operational task until a later governed retention story exists

Fail-closed rule:

- if a workflow requests a screenshot without a defined evidence-purpose metadata block, the capture may execute for live/runtime use, but durable write-to-disk must be blocked

Follow-on next steps:

1. Refine documentation: explicitly link SIC-style review to the `keep_until_manual_review` enum in `docs/architecture/as-built_execution_atlas.md`
2. Story C backlog: evaluate whether a future `ttl_90d` or `ttl_audit` retention mode is necessary to prevent long-term evidence storage bloat without changing the current sprint policy
3. Audit trail: ensure the `manual_review` deletion action emits a signed log entry with who, when, and why for SIC evidence cleanup

## Branch Map

### Branch 1: Live UI Screenshots

Source:

- `src/ui/server.ts`
- `src/session/manager.ts`

Paths:

- websocket `type: "screenshot"` payload with `screenshotBase64`
- `GET /api/screenshot` response with `{ base64, url }`

Current behavior:

- captures JPEG base64 through `sessionManager.screenshot()`
- UI renders with hardcoded `data:image/jpeg;base64,`
- no screenshot-specific authentication, redaction, retention, or sensitivity policy found

Open questions:

- Should `/api/screenshot` require a bound UI session/client?
- Should screenshots be disabled during `pii_wait` or sensitive step execution?
- Should live frames ever be written to disk?

Provisional decision:

- live frames should be ephemeral and blocked or masked during sensitive phases

### Branch 2: Browser-use Action Screenshots

Source:

- `src/engines/browser-use/server/main.py`
- `src/engines/python-bridge.ts`
- `src/ui/server.ts`

Paths:

- browser-use step callback includes `screenshot_b64`
- TypeScript maps it to `BrowserUseActionEvent.screenshotBase64`
- UI receives `browser_use_action` event but does not render the screenshot

Current behavior:

- screenshot data can be transported but is not visible in the UI screenshot pane
- action telemetry records whether a screenshot was included, not the image itself

Open questions:

- Should action screenshots be rendered live?
- Should they ever be persisted?
- Are these screenshots PNG, JPEG, or browser-use-version dependent?

Provisional decision:

- render live when present after adding MIME-aware payloads
- do not persist by default
- persist only if explicitly promoted to evidence

### Branch 3: Workflow Screenshot Step

Source:

- `src/workflow/engine.ts`
- `src/workflow/types.ts`

Paths:

- captures through `sessionManager.screenshot()`
- writes `.jpg` under `SESSION_DIR/workflow` or `./sessions/workflow`
- stores `{ path, base64, stepId }` in `WorkflowResult.screenshots`
- step result includes `screenshotPath` and `screenshotBase64`

Current behavior:

- durable file is written
- base64 remains in workflow result

Open questions:

- Should a workflow `screenshot` step always mean durable evidence?
- Should workflow definitions declare screenshot purpose and retention?
- Should base64 be stripped before wrap-up persistence?

Provisional decision:

- explicit `screenshot` steps may create durable artifacts, but they need purpose/retention metadata
- durable records should prefer path plus metadata, not embedded base64

### Branch 4: Workflow Wrap-Up And SQLite Persistence

Source:

- `src/workflow/wrap-up.ts`
- `src/db/repository.ts`
- `src/db/migrations/002_workflow_runs.sql`

Paths:

- `workflow_runs.result_json`
- wrap-up artifact JSON files

Current behavior:

- wrap-up persists full `WorkflowResult`
- if screenshots include base64, base64 is persisted in DB and artifact JSON

Open questions:

- Should wrap-up sanitize screenshot payloads before persistence?
- Should old result JSON remain backward-compatible?
- Should evidence screenshot metadata get a normalized table?

Provisional decision:

- sanitize result JSON before persistence
- keep path, MIME, source, purpose, retention, sensitivity
- drop base64 unless a story explicitly opts in

### Branch 5: Session Screenshot Index

Source:

- `src/db/repository.ts`
- `src/db/migrations/001_init.sql`
- `src/cli/index.ts`

Paths:

- `session_screenshots` table

Current behavior:

- stores screenshot paths from saved task/workflow result screenshots
- does not index rolling screenshots

Open questions:

- Should this table remain path-only?
- Should it be extended with source, purpose, retention, and sensitivity?
- Should workflow screenshots be represented here or only in workflow result JSON?

Provisional decision:

- if durable screenshots remain queryable, extend metadata rather than creating a parallel hidden policy

### Branch 6: Rolling Screenshots

Source:

- `src/session/manager.ts`

Paths:

- `SESSION_DIR/rolling` or `./sessions/rolling`
- telemetry event `session.screenshot.rolling`

Current behavior:

- writes JPEG files repeatedly
- not indexed in `session_screenshots`
- no TTL cleanup found

Open questions:

- Are rolling screenshots needed in production?
- Should rolling be disabled by default?
- What TTL should apply?

Provisional decision:

- rolling screenshots should be short-lived debug artifacts only
- delete on successful wrap-up unless debugging mode is enabled
- never capture during sensitive phases

### Branch 7: MCP Screenshot Tool

Source:

- `src/mcp/server.ts`

Paths:

- `browser_screenshot` returns image content with `mimeType: "image/jpeg"`

Current behavior:

- live tool output only
- no durable write by this path

Open questions:

- Should MCP screenshot access be blocked during sensitive phases?
- Should MCP screenshot calls emit audit telemetry?

Provisional decision:

- treat MCP screenshot as a privileged live capture
- add sensitive-phase gate before capture

### Branch 8: Orchestrator Screenshot Tool

Source:

- `src/orchestrator/loop.ts`

Paths:

- captures PNG through Playwright page screenshot
- stores base64 in `outputs[output_key]`

Current behavior:

- output value may later persist through workflow result/wrap-up paths
- no MIME metadata carried with the output

Open questions:

- Should orchestrator screenshots store a container instead of raw base64?
- Should output keys with screenshot data be redacted from long-term persistence?

Provisional decision:

- replace raw base64 output with a screenshot payload reference/container

## Sensitive Data Risk Register

Potential sensitive screenshot content:

- DOB, SSN, address, phone, email
- credentials and password manager overlays
- payment forms and account pages
- medical/legal/financial account data
- private messages or social account dashboards
- HITL secure input target fields

Current control coverage:

- typed PII values have HITL secure input handling
- screenshot pixels do not appear to have equivalent classification/redaction/retention handling

Risk:

- screenshots can bypass text redaction controls because the sensitive data is in image pixels

## Candidate Policy

### Screenshot Classes

- `live_frame`: ephemeral UI visibility, never durable
- `debug_frame`: short TTL, local-only, disabled by default in sensitive phases
- `evidence`: explicit retained artifact proving outcome/failure/operator decision
- `sensitive_blocked`: capture refused because sensitive phase/page is active

### Evidence Screenshot Definition

An evidence screenshot is a screenshot intentionally retained after task completion because it proves a workflow-relevant state, side effect, failure, rejection, or operator-confirmed outcome, and is allowed by the workflow screenshot policy.

Qualifying examples:

- final confirmation page after an external side effect
- failed postcondition state
- HITL rejection evidence
- user-requested screenshot artifact
- regulated/audit workflow proof

Non-qualifying examples:

- rolling frames
- live HITL frames
- browser-use intermediate action screenshots
- screenshots captured during `pii_wait`
- screenshots of sensitive forms unless explicitly redacted/approved

## Candidate Screenshot Container

```ts
interface ScreenshotPayload {
  id: string;
  source:
    | 'session_manager'
    | 'browser_use_action'
    | 'browser_use_endpoint'
    | 'orchestrator'
    | 'workflow_step'
    | 'mcp'
    | 'rolling';
  class: 'live_frame' | 'debug_frame' | 'evidence' | 'sensitive_blocked';
  mimeType: 'image/jpeg' | 'image/png';
  base64?: string;
  path?: string;
  takenAt: string;
  sessionId?: string;
  workflowId?: string;
  stepId?: string;
  url?: string;
  sensitivity: 'unknown' | 'safe' | 'sensitive' | 'blocked';
  retention: 'ephemeral' | 'delete_on_success' | 'ttl_24h' | 'ttl_7d' | 'keep_until_manual_review';
  persistBase64: false;
}
```

## Candidate Guardrails

- Do not capture screenshots during `pii_wait`.
- Pause rolling screenshots while sensitive fields are active.
- Strip screenshot base64 before writing `workflow_runs.result_json`.
- Persist durable screenshots as path plus metadata only.
- Delete rolling/debug screenshots on successful wrap-up.
- Keep evidence screenshots only when explicit policy says so.
- Add MIME-aware UI rendering.
- Audit screenshot capture requests from UI and MCP.

## Action Checklist

Completed in practice:

- `US-035` / `RF-017` completed the screenshot policy and design decisions.
- `US-036` / `RF-018` completed the screenshot payload contract work.
- `US-037` / `RF-019` completed the screenshot persistence sanitization work.
- The next actionable unchecked story is `Story D: Sensitive Screenshot Gate`.

### US-035 Decision Matrix Audit Log

Audit scope: confirm that every design-only decision required by `US-035` / `RF-017` was explicitly answered and landed in the governed policy artifact.

- [x] Screenshot classes defined: `live_frame`, `debug_frame`, `evidence`, `sensitive_blocked`.
- [x] Sensitivity states defined: `unknown`, `safe`, `sensitive`, `blocked`.
- [x] `pii_wait` capture behavior defined.
- [x] Sensitive-target step capture behavior defined.
- [x] Private account/page sensitivity behavior defined.
- [x] Evidence screenshot definition recorded.
- [x] Durable screenshot model decided as strict opt-in evidence retention.
- [x] Branch-by-branch capture policy recorded for UI, `/api/screenshot`, browser-use, workflow steps, wrap-up, session index, rolling, MCP, orchestrator, and bridge endpoints.
- [x] Durable persistence policy recorded for filesystem artifacts.
- [x] Durable persistence policy recorded for `workflow_runs.result_json`.
- [x] Durable persistence policy recorded for wrap-up artifact JSON.
- [x] Durable persistence policy recorded for `session_screenshots`.
- [x] Live retention policy defined.
- [x] Debug and rolling retention policy defined.
- [x] Evidence retention policy defined as `keep_until_manual_review` by default.
- [x] Access policy recorded for `/api/screenshot`.
- [x] MCP screenshot access and audit policy recorded.
- [x] Screenshot telemetry and audit fields defined.
- [x] Encryption-at-rest default decided for durable evidence screenshots.
- [x] Historical screenshot base64 policy decided as forward-only sanitization plus legacy retention rationale.
- [x] Follow-on implementation split defined: payload contract, persistence sanitization, sensitive screenshot gate, rolling/debug cleanup.

Completion source:

- `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design.md`
- `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design-definition-of-done.md`
- `docs/history/forge_history.md` (`H-035`)
- `prd.json` (`US-035` passed)
- `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md` (`RF-017` completed)

### Policy And Design

- [x] Define the screenshot policy layer explicitly: classes, sensitivity states, retention modes, and persistence rules.
- [x] Decide whether live screenshots are ephemeral by default across UI, MCP, and orchestrator paths.
- [x] Decide whether explicit workflow `screenshot` steps always mean durable evidence or require per-step purpose metadata.
- [x] Decide whether evidence screenshots require encryption at rest.

Close the loop decision:

- Define the screenshot policy layer explicitly: closed by `US-035` / `RF-017`; landed in `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design.md` through the class taxonomy, sensitivity model, persistence policy, and retention policy sections.
- Decide whether live screenshots are ephemeral by default across UI, MCP, and orchestrator paths: closed by `US-035` / `RF-017`; live screenshots are `live_frame`, non-durable, and `ephemeral` by default.
- Decide whether explicit workflow `screenshot` steps always mean durable evidence or require per-step purpose metadata: closed by `US-035` / `RF-017`; workflow `screenshot` steps require explicit evidence-purpose policy and are not automatic durable retention merely because bytes exist.
- Decide whether explicit workflow `screenshot` steps always mean durable evidence or require per-step purpose metadata: closed by `US-035` / `RF-017`; workflow `screenshot` steps require explicit evidence-purpose policy, are not automatic durable retention merely because bytes exist, and should fail closed for durable writes when evidence-purpose metadata is missing.
- Decide whether evidence screenshots require encryption at rest: closed by `US-035` / `RF-017`; durable evidence screenshots require encryption at rest by default unless a future safe explicit opt-out is defined.

### Payload Contract

- [x] Introduce a canonical `ScreenshotPayload` contract with source, MIME type, sensitivity, retention, and persistence metadata.
- [x] Replace raw screenshot base64 outputs in orchestrator paths with a screenshot payload container or reference.
- [x] Make browser-use action screenshot payloads MIME-aware.
- [x] Update UI rendering to use payload `mimeType` instead of hardcoded JPEG assumptions.

Close the loop decision:

- Introduce a canonical `ScreenshotPayload` contract with source, MIME type, sensitivity, retention, and persistence metadata: closed by `US-036` / `RF-018`; the shared runtime screenshot payload contract now exists and is the canonical live/runtime container.
- Replace raw screenshot base64 outputs in orchestrator paths with a screenshot payload container or reference: closed by `US-036` / `RF-018`; orchestrator screenshot outputs now flow through the payload container path instead of remaining raw standalone base64.
- Make browser-use action screenshot payloads MIME-aware: closed by `US-036` / `RF-018`; browser-use action screenshot payloads now carry MIME information instead of relying on implicit JPEG assumptions.
- Update UI rendering to use payload `mimeType` instead of hardcoded JPEG assumptions: closed by `US-036` / `RF-018`; UI rendering now follows payload MIME metadata.

### Sensitive-Phase Controls

- [x] Block screenshot capture during `pii_wait`.
- [x] Block or mask screenshots during sensitive-target step execution.
- [x] Redact known sensitive DOM regions before capture when metadata is sufficient.
- [x] Return structured denial metadata with `blockedReason` and `nextAction` when capture is blocked.
- [x] Add step-scoped TTL screenshots that delete bytes on workflow step advance.
- [x] Add sensitive-phase gates for MCP screenshot capture.
- [x] Add sensitive-phase gates for live UI screenshot capture.
- [x] Add sensitive-phase gates for rolling screenshot capture.
- [x] Emit telemetry when screenshot capture is blocked by policy.

Close the loop decision:

- Block screenshot capture during `pii_wait`: closed by `US-038` / `RF-020`; blocked captures now return structured denial metadata with no pixels.
- Block or mask screenshots during sensitive-target step execution: closed by `US-038` / `RF-020`; selector-known sensitive targets redact via Playwright masking and other sensitive targets fail closed.
- Redact known sensitive DOM regions before capture when metadata is sufficient: closed by `US-038` / `RF-020`; the runtime now masks selector-known sensitive regions before returning screenshots.
- Return structured denial metadata with `blockedReason` and `nextAction` when capture is blocked: closed by `US-038` / `RF-020`.
- Add step-scoped TTL screenshots that delete bytes on workflow step advance: closed by `US-038` / `RF-020`.
- Add sensitive-phase gates for MCP screenshot capture: closed by `US-038` / `RF-020`.
- Add sensitive-phase gates for live UI screenshot capture: closed by `US-038` / `RF-020`.
- Add sensitive-phase gates for rolling screenshot capture: closed by `US-038` / `RF-020`.
- Emit telemetry when screenshot capture is blocked by policy: closed by `US-038` / `RF-020`; allow/redact/block/delete decisions emit byte-free telemetry.

### Persistence Hardening

- [x] Strip screenshot base64 before persisting `workflow_runs.result_json`.
- [x] Strip screenshot base64 before wrap-up artifact JSON is written.
- [x] Keep durable screenshot records as path plus metadata rather than embedded base64.
- [ ] Decide whether screenshot metadata should remain split across `session_screenshots` and workflow result JSON or be normalized further.
- [ ] Extend durable screenshot metadata with source, purpose, retention, and sensitivity if durable screenshot querying remains supported.
- [ ] Guard rail: if `mode: agentic` remains in service long enough to execute durable screenshot workflows, sanitize JSON-encoded `ScreenshotPayload` values in `WorkflowResult.outputs` before persistence or block durable screenshot output keys.

Close the loop decision:

- Strip screenshot base64 before persisting `workflow_runs.result_json`: closed by `US-037` / `RF-019`; new durable SQLite workflow result writes now sanitize `stepResults[].screenshotBase64` at the wrap-up persistence boundary.
- Strip screenshot base64 before wrap-up artifact JSON is written: closed by `US-037` / `RF-019`; new wrap-up artifact JSON now sanitizes `screenshots[].base64` before the file write.
- Keep durable screenshot records as path plus metadata rather than embedded base64: closed by `US-037` / `RF-019` for the sanitize-first slice; new durable writes keep path and available screenshot metadata while leaving runtime `WorkflowResult` objects unchanged in process.
- Decide whether screenshot metadata should remain split across `session_screenshots` and workflow result JSON or be normalized further: still open; owned by `Story C: Screenshot Persistence Sanitization`.
- Extend durable screenshot metadata with source, purpose, retention, and sensitivity if durable screenshot querying remains supported: still open; owned by `Story C: Screenshot Persistence Sanitization`.
- Evaluate whether a future `ttl_90d` or `ttl_audit` retention mode is necessary for long-lived evidence without changing the current `keep_until_manual_review` default: still open; owned by `Story C: Screenshot Persistence Sanitization`.
- Agentic/orchestrator screenshot output guard rail: not a reopened `US-037` defect after the direct production path passed. If `mode: agentic` is not retired before further screenshot-bearing production use, add a targeted guard that sanitizes or blocks JSON-encoded `ScreenshotPayload.base64` stored in `WorkflowResult.outputs`.

### Rolling Screenshot Cleanup

- [ ] Decide whether rolling screenshots should be enabled by default in production.
- [ ] Define TTL behavior for rolling/debug screenshots.
- [ ] Delete rolling/debug screenshots on successful wrap-up unless debug mode is enabled.
- [ ] Confirm rolling screenshots are never captured during sensitive phases.

Close the loop decision:

- Decide whether rolling screenshots should be enabled by default in production: policy direction is closed by `US-035` / `RF-017` as disabled by default outside debugging mode; runtime enforcement remains open and should be implemented with rolling cleanup work.
- Define TTL behavior for rolling/debug screenshots: policy direction is closed by `US-035` / `RF-017` as `ttl_24h` for failed/debug runs; runtime enforcement remains open and should be implemented with rolling cleanup work.
- Delete rolling/debug screenshots on successful wrap-up unless debug mode is enabled: policy direction is closed by `US-035` / `RF-017`; runtime enforcement remains open and should be implemented with rolling cleanup work.
- Confirm rolling screenshots are never captured during sensitive phases: closed by `US-038` / `RF-020`; sensitive rolling captures now block or step-scope through the shared policy gate.

### Live Access And Auditing

- [x] Decide whether `GET /api/screenshot` should require bound client/session checks similar to other HITL-sensitive endpoints.
- [ ] Add audit telemetry for screenshot capture requests from UI endpoints.
- [ ] Add audit telemetry for MCP screenshot capture requests.
- [x] Decide whether browser-use action screenshots should be rendered live in the UI when present.

Close the loop decision:

- Decide whether `GET /api/screenshot` should require bound client/session checks similar to other HITL-sensitive endpoints: closed by `US-035` / `RF-017`; the policy requires bound client/session checks and blocked-phase denial.
- Add audit telemetry for screenshot capture requests from UI endpoints: closed by `US-038` / `RF-020`; UI screenshot allow/block outcomes now emit byte-free telemetry with binding and decision context.
- Add audit telemetry for MCP screenshot capture requests: closed by `US-038` / `RF-020`; MCP screenshot decisions now emit the same byte-free policy telemetry path.
- Decide whether browser-use action screenshots should be rendered live in the UI when present: closed by `US-035` / `RF-017` and implemented by `US-036` / `RF-018`; they should render live through MIME-aware payloads and remain non-durable by default.

### Legacy And Migration

- [x] Decide whether historical result JSON containing screenshot base64 should be migrated, sanitized forward-only, or left as legacy data.
- [ ] Decide whether old durable screenshot artifacts need a compatibility path after payload contract changes.

Close the loop decision:

- Decide whether historical result JSON containing screenshot base64 should be migrated, sanitized forward-only, or left as legacy data: closed by `US-035` / `RF-017`; use forward-only sanitization and leave historical base64 as documented legacy data.
- Decide whether old durable screenshot artifacts need a compatibility path after payload contract changes: still open; evaluate during `Story C` if any durable artifact readers depend on pre-payload shapes.
- Decide whether old durable screenshot artifacts need a compatibility path after payload contract changes: still open; evaluate during `Story C` if any durable artifact readers depend on pre-payload shapes.
- Ensure `manual_review` deletion emits a signed log entry with who, when, and why for SIC-style evidence cleanup: still open; should be implemented with later persistence/audit cleanup work after the sanitize-first storage boundary is in place.

### Forge Story Packaging

- [x] Promote Story A: Screenshot Security Policy Design if the policy surface needs a design-first story.
- [x] Promote Story B: Screenshot Payload Contract if the runtime/UI payload work is approved.
- [x] Promote Story C: Screenshot Persistence Sanitization if durable storage cleanup is approved.
- [x] Promote Story D: Screenshot Capture Policy Gate if screenshot blocking/redaction/step-TTL rules are approved.

Close the loop decision:

- Promote Story A: Screenshot Security Policy Design if the policy surface needs a design-first story: closed by `US-035` / `RF-017`.
- Promote Story B: Screenshot Payload Contract if the runtime/UI payload work is approved: closed by `US-036` / `RF-018`.
- Promote Story C: Screenshot Persistence Sanitization if durable storage cleanup is approved: closed and implemented by `US-037` / `RF-019`.
- Promote Story D: Screenshot Capture Policy Gate if screenshot blocking/redaction/step-TTL rules are approved: closed and implemented by `US-038` / `RF-020`.

## Possible Forge Story Split

### Story A: Screenshot Security Policy Design

Deliverable:

- define screenshot classes, retention rules, sensitive-phase gates, and persistence policy

Promotion:

- promoted to `US-035` / `RF-017`
- story package:
  - `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design-storyline.md`
  - `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design-forge-story.yaml`
  - `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design-implementation-handoff.md`
  - `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design-definition-of-done.md`

### Story B: Screenshot Payload Contract

Deliverable:

- introduce `ScreenshotPayload`
- update UI rendering to use `mimeType`
- render browser-use action screenshots live

### Story C: Screenshot Persistence Sanitization

Deliverable:

- strip base64 before DB/wrap-up persistence
- keep path plus metadata
- keep runtime `WorkflowResult` compatibility before persistence
- leave rolling/debug cleanup for the dedicated cleanup story
- leave fail-closed durable-write validation for the follow-on authoring/access gate work
- decide whether compatibility handling is needed for old durable screenshot artifacts
- evaluate whether a future `ttl_90d` or `ttl_audit` retention mode is necessary
- ensure `manual_review` deletion produces a signed who/when/why audit log for SIC-style evidence cleanup

Promotion:

- promoted to `US-037` / `RF-019`
- story package:
  - `docs/artifacts/2026-05-02-us037-rf019-screenshot-persistence-sanitization-storyline.md`
  - `docs/artifacts/2026-05-02-us037-rf019-screenshot-persistence-sanitization-forge-story.yaml`
  - `docs/artifacts/2026-05-02-us037-rf019-screenshot-persistence-sanitization-implementation-handoff.md`
  - `docs/artifacts/2026-05-02-us037-rf019-screenshot-persistence-sanitization-definition-of-done.md`

### Story D: Screenshot Capture Policy Gate

Deliverable:

- classify screenshot capture requests as `live_frame`, `debug_frame`, `step_scoped`, `evidence`, or `sensitive_blocked`
- redact/mask known sensitive DOM regions before capture when safe
- block with structured `blockedReason` and `nextAction` metadata when pixels cannot be safely returned
- delete step-scoped screenshot bytes on workflow step advance
- gate `GET /api/screenshot` using the `US-024` active session/client binding pattern
- gate MCP screenshot capture through the same policy decision contract
- pause, deny, or step-scope live/rolling screenshots during sensitive phases
- emit byte-free telemetry for allow/redact/block/delete decisions

Promotion:

- promoted to `US-038` / `RF-020`
- story package:
  - `docs/artifacts/2026-05-02-us038-rf020-screenshot-capture-policy-gate-storyline.md`
  - `docs/artifacts/2026-05-02-us038-rf020-screenshot-capture-policy-gate-forge-story.yaml`
  - `docs/artifacts/2026-05-02-us038-rf020-screenshot-capture-policy-gate-implementation-handoff.md`
  - `docs/artifacts/2026-05-02-us038-rf020-screenshot-capture-policy-gate-definition-of-done.md`

## Current Open Decisions

- Should rolling screenshots be enabled by default?
- Does Story C need a future `ttl_90d` or `ttl_audit` retention mode for long-lived evidence?
- How should the signed `manual_review` deletion log be represented and enforced?
- Do old durable screenshot artifacts need a compatibility path after payload-contract changes?
- Guard rail only: if `mode: agentic` survives long enough for production screenshot workflows, should orchestrator `outputs[output_key]` be sanitized for embedded `ScreenshotPayload.base64`, or should screenshot output keys be blocked at the orchestrator boundary?

## Source Files To Keep In View

- `src/session/manager.ts`
- `src/ui/server.ts`
- `src/session/types.ts`
- `src/workflow/engine.ts`
- `src/workflow/types.ts`
- `src/workflow/wrap-up.ts`
- `src/db/repository.ts`
- `src/db/migrations/001_init.sql`
- `src/db/migrations/002_workflow_runs.sql`
- `src/orchestrator/loop.ts`
- `src/mcp/server.ts`
- `src/engines/python-bridge.ts`
- `src/engines/browser-use/server/main.py`
- `src/engines/skyvern/server/main.py`
