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
- screenshot base64 is not persisted by default
- sensitive phases block or restrict screenshot capture
- every screenshot crossing a boundary carries source, MIME type, sensitivity, and retention metadata

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

### Policy And Design

- [ ] Define the screenshot policy layer explicitly: classes, sensitivity states, retention modes, and persistence rules.
- [ ] Decide whether live screenshots are ephemeral by default across UI, MCP, and orchestrator paths.
- [ ] Decide whether explicit workflow `screenshot` steps always mean durable evidence or require per-step purpose metadata.
- [ ] Decide whether evidence screenshots require encryption at rest.

### Payload Contract

- [ ] Introduce a canonical `ScreenshotPayload` contract with source, MIME type, sensitivity, retention, and persistence metadata.
- [ ] Replace raw screenshot base64 outputs in orchestrator paths with a screenshot payload container or reference.
- [ ] Make browser-use action screenshot payloads MIME-aware.
- [ ] Update UI rendering to use payload `mimeType` instead of hardcoded JPEG assumptions.

### Sensitive-Phase Controls

- [ ] Block screenshot capture during `pii_wait`.
- [ ] Block or mask screenshots during sensitive-target step execution.
- [ ] Add sensitive-phase gates for MCP screenshot capture.
- [ ] Add sensitive-phase gates for live UI screenshot capture.
- [ ] Add sensitive-phase gates for rolling screenshot capture.
- [ ] Emit telemetry when screenshot capture is blocked by policy.

### Persistence Hardening

- [ ] Strip screenshot base64 before persisting `workflow_runs.result_json`.
- [ ] Strip screenshot base64 before wrap-up artifact JSON is written.
- [ ] Keep durable screenshot records as path plus metadata rather than embedded base64.
- [ ] Decide whether screenshot metadata should remain split across `session_screenshots` and workflow result JSON or be normalized further.
- [ ] Extend durable screenshot metadata with source, purpose, retention, and sensitivity if durable screenshot querying remains supported.

### Rolling Screenshot Cleanup

- [ ] Decide whether rolling screenshots should be enabled by default in production.
- [ ] Define TTL behavior for rolling/debug screenshots.
- [ ] Delete rolling/debug screenshots on successful wrap-up unless debug mode is enabled.
- [ ] Confirm rolling screenshots are never captured during sensitive phases.

### Live Access And Auditing

- [ ] Decide whether `GET /api/screenshot` should require bound client/session checks similar to other HITL-sensitive endpoints.
- [ ] Add audit telemetry for screenshot capture requests from UI endpoints.
- [ ] Add audit telemetry for MCP screenshot capture requests.
- [ ] Decide whether browser-use action screenshots should be rendered live in the UI when present.

### Legacy And Migration

- [ ] Decide whether historical result JSON containing screenshot base64 should be migrated, sanitized forward-only, or left as legacy data.
- [ ] Decide whether old durable screenshot artifacts need a compatibility path after payload contract changes.

### Forge Story Packaging

- [ ] Promote Story A: Screenshot Security Policy Design if the policy surface needs a design-first story.
- [ ] Promote Story B: Screenshot Payload Contract if the runtime/UI payload work is approved.
- [ ] Promote Story C: Screenshot Persistence Sanitization if durable storage cleanup is approved.
- [ ] Promote Story D: Sensitive Screenshot Gate if screenshot blocking rules are approved.

## Possible Forge Story Split

### Story A: Screenshot Security Policy Design

Deliverable:

- define screenshot classes, retention rules, sensitive-phase gates, and persistence policy

### Story B: Screenshot Payload Contract

Deliverable:

- introduce `ScreenshotPayload`
- update UI rendering to use `mimeType`
- render browser-use action screenshots live

### Story C: Screenshot Persistence Sanitization

Deliverable:

- strip base64 before DB/wrap-up persistence
- keep path plus metadata
- add retention cleanup for rolling/debug screenshots

### Story D: Sensitive Screenshot Gate

Deliverable:

- block live/durable/MCP/rolling captures during `pii_wait` or sensitive-target steps
- emit telemetry when capture is blocked

## Current Open Decisions

- Should rolling screenshots be enabled by default?
- What TTL is acceptable for debug screenshots?
- Should evidence screenshots be encrypted at rest?
- Should `GET /api/screenshot` require client/session binding like HITL return-control endpoints?
- Should old screenshot base64 in historical result JSON be migrated or left as legacy?

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

