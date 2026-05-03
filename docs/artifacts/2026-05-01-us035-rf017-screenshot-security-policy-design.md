# Screenshot Security Policy Design

Story: `US-035`
Tracker Row: `RF-017`
Date: `2026-05-01`
Status: `Design complete`

## 1. Current Architecture Summary

The screenshot subsystem currently spans live UI transport, MCP tool output, direct workflow steps, agentic orchestration, Python bridge endpoints, filesystem artifacts, SQLite persistence, and wrap-up artifact persistence.

The main current branches are:

1. Live UI screenshots via WebSocket `type: "screenshot"` payloads and `GET /api/screenshot`
2. Browser-use action screenshots carried inside `browser_use_action` events
3. Direct workflow `screenshot` steps that write `.jpg` files and keep base64 in `WorkflowResult`
4. Workflow wrap-up and SQLite persistence, which can retain screenshot base64 through `workflow_runs.result_json` and wrap-up artifact JSON
5. Session screenshot indexing through `session_screenshots`
6. Rolling screenshots written under `SESSION_DIR/rolling` or `./sessions/rolling`
7. MCP `browser_screenshot` tool responses
8. Orchestrator screenshot tool outputs stored in workflow outputs
9. Python bridge screenshot endpoints that return `{ path, base64, taken_at }`

Current risk pattern: screenshot pixels can contain sensitive data, but screenshots do not yet have a dedicated policy for sensitivity, retention, persistence, access, audit, or sensitive-phase blocking.

## 2. Screenshot Class Taxonomy

All screenshot paths must classify each screenshot into exactly one class at capture time.

| Class | Purpose | Durability | Base64 policy | Default retention |
| --- | --- | --- | --- | --- |
| `live_frame` | operator visibility or live tool response only | non-durable | allowed in memory only | `ephemeral` |
| `debug_frame` | short-lived debugging or investigation artifact | durable by exception | never durable | `delete_on_success` or `ttl_24h` |
| `evidence` | explicit retained artifact proving a workflow-relevant state or decision | durable | never durable by default | `keep_until_manual_review` |
| `sensitive_blocked` | refused capture due to active sensitive policy | no image captured | none | no retention |

Policy rule: screenshots are not neutral artifacts. Any screenshot without an explicit class must be treated as policy-invalid and must not cross a persistence boundary.

## 3. Sensitivity Model

Every screenshot boundary must carry one sensitivity state:

| Sensitivity | Meaning | Capture policy |
| --- | --- | --- |
| `unknown` | capture source cannot yet prove safety | allow live-only if branch policy permits; block durable persistence by default |
| `safe` | page/state is not known to contain sensitive material | allow policy-defined live or durable handling |
| `sensitive` | page/state may contain credentials, PII, account data, or private dashboards | block live and durable capture unless an explicit evidence policy exception exists |
| `blocked` | capture was refused by policy | no screenshot bytes may be emitted |

Sensitive states must be inferred from at least the following conditions:

1. `pii_wait` is always `sensitive` and capture must be blocked.
2. Sensitive-target step execution is `sensitive` and capture must be blocked.
3. Secure input targets are `sensitive` and capture must be blocked.
4. Private authenticated account pages are `sensitive` by default unless a workflow policy explicitly downgrades them for a specific evidence step.
5. Unknown browser-use or orchestrator screenshots must default to `unknown`, not `safe`.

## 4. Evidence Screenshot Definition

An evidence screenshot is a screenshot intentionally retained after task completion because it proves a workflow-relevant state, side effect, failure, rejection, or operator-confirmed outcome, and is explicitly allowed by workflow screenshot policy.

Qualifying evidence examples:

1. Final confirmation page after an external side effect
2. Failed postcondition state that proves why the workflow stopped
3. HITL rejection evidence
4. User-requested screenshot artifact
5. Regulated or audit proof required by workflow policy

Non-qualifying examples:

1. Rolling frames
2. Live HITL frames
3. Browser-use intermediate action screenshots
4. Screenshots taken during `pii_wait`
5. Screenshots of sensitive forms unless explicitly approved and redacted by policy

Decision: durable screenshots are opt-in evidence artifacts by default. No branch may become durable merely because it already produces image bytes.

## 5. Capture Policy By Branch

| Branch | Default class | Live allowed | Durable allowed | Sensitive-phase behavior | Notes |
| --- | --- | --- | --- | --- | --- |
| Live UI WebSocket screenshots | `live_frame` | yes | no | block during `pii_wait` and sensitive-target steps | mask or suppress rather than downgrade to durable |
| `GET /api/screenshot` | `live_frame` | yes | no | block during `pii_wait` and sensitive-target steps | must require active bound UI client/session |
| Browser-use action screenshots | `live_frame` | yes | no | block when active phase is sensitive | may be rendered live when MIME-aware payload exists |
| Workflow `screenshot` steps | `evidence` by explicit step contract | yes | yes | block if step occurs in `pii_wait` or sensitive-target context unless explicit approved exception exists | workflow definitions must declare purpose and retention; if evidence-purpose metadata is missing, capture may execute but durable write-to-disk must fail closed |
| Workflow wrap-up / SQLite persistence | no capture; persistence branch only | n/a | only evidence metadata | never persist base64 by default | sanitize before persistence |
| `session_screenshots` index | no capture; metadata index only | n/a | yes, metadata only | must not index blocked captures | extend metadata instead of hidden policy |
| Rolling screenshots | `debug_frame` | no user-facing live dependency | yes, short-lived only | always blocked during `pii_wait` and sensitive-target steps | disabled by default outside debugging mode |
| MCP `browser_screenshot` | `live_frame` | yes | no | block during `pii_wait` and sensitive-target steps | privileged capture with mandatory audit telemetry |
| Orchestrator screenshot tool outputs | `live_frame` | yes | no by default | block during `pii_wait` and sensitive-target steps | replace raw base64 output with metadata container/reference |
| Python bridge screenshot endpoints | branch-dependent capture primitive | yes | only when caller branch policy allows | must inherit caller sensitivity rules | endpoint alone must not imply durable retention |

## 6. Persistence Policy By Destination

### Filesystem image artifacts

1. `live_frame` screenshots must not be written to disk by default.
2. `debug_frame` screenshots may be written locally only when debugging mode is enabled.
3. `evidence` screenshots may be written to disk if workflow policy explicitly authorizes them.
4. `sensitive_blocked` must write no file.

### `workflow_runs.result_json`

1. Base64 screenshot bytes must not be persisted by default.
2. Persist path plus metadata only for evidence screenshots.
3. `live_frame` and `debug_frame` data may not be serialized into durable workflow result JSON.

### Wrap-up artifact JSON

1. Wrap-up must sanitize screenshot payloads before writing artifact JSON.
2. Evidence screenshots may persist path plus metadata only.
3. Base64 must be dropped unless a future workflow-specific exception is explicitly designed and approved.

### `session_screenshots`

1. The table should remain a durable metadata index, not a base64 store.
2. If queryable durable screenshots remain supported, extend metadata with source, purpose, retention, and sensitivity.
3. Rolling screenshots must not be silently indexed without a dedicated indexing policy story.

## 7. Retention And Cleanup Policy

| Class | Retention | Cleanup rule |
| --- | --- | --- |
| `live_frame` | `ephemeral` | drop after response/render cycle; never persist |
| `debug_frame` | `delete_on_success` by default, `ttl_24h` for failed/debug runs | delete on successful wrap-up unless debugging mode is enabled; otherwise TTL cleanup |
| `evidence` | `keep_until_manual_review` by default | retain until explicit review/approval/rejection workflow clears it; regulated flows may define longer retention |
| `sensitive_blocked` | none | no bytes, no file, no durable record |

Decision: SIC-style screenshot review uses the existing `keep_until_manual_review` retention mode. Do not introduce a separate `SIC TTL` in this policy/story.

Operational note: retained evidence remains a manual storage-management task until a later story explicitly introduces a governed long-tail retention mode.

Decision: rolling screenshots are short-lived debug artifacts only and should be disabled by default in production-facing runs.

## 8. API, MCP Access, And Audit Policy

### `GET /api/screenshot`

Decision: require active client/session binding comparable to other HITL-sensitive control endpoints.

Requirements:

1. Request must map to the active workflow session.
2. Request must come from a bound live UI client.
3. Request must be denied during blocked sensitive phases.
4. Access decisions must emit audit telemetry.

### MCP `browser_screenshot`

Decision: treat as privileged live capture.

Requirements:

1. Block during `pii_wait` and sensitive-target steps.
2. Emit audit telemetry for every allowed request.
3. Emit block telemetry for denied requests.
4. Return live-only image content; no durable write by default.

### Browser-use action screenshots

Decision: may be rendered live when present, but only through MIME-aware payloads and never persisted by default.

## 9. Telemetry And Audit Policy

Every screenshot capture decision must emit one of the following telemetry outcomes:

1. capture_allowed
2. capture_blocked
3. capture_sanitized_for_persistence
4. capture_deleted_by_retention

Minimum telemetry fields:

1. source branch
2. screenshot class
3. sensitivity
4. retention mode
5. MIME type, if capture occurred
6. session id, workflow id, and step id when available
7. access path (`ui`, `mcp`, `workflow`, `orchestrator`, `bridge`, `rolling`)

Policy rule: audit telemetry should describe the screenshot decision, not log screenshot bytes.

Manual-review deletion rule: when a `keep_until_manual_review` evidence screenshot is deleted after review, the deletion path must emit a signed audit log entry containing who approved the deletion, when it occurred, and why the evidence was removed. The log must not include screenshot bytes.

## 10. Encryption At Rest Decision

Decision: durable evidence screenshots must be encrypted at rest by default unless they are explicitly classified as `safe` and a future workflow policy intentionally opts out.

Rationale:

1. Evidence screenshots may contain private account pages, regulated proof, rejection evidence, or sensitive postcondition state.
2. Screenshot pixels bypass text-redaction controls.
3. Default encryption is safer than relying on perfect sensitivity detection.

Implementation note: this story does not choose the exact encryption mechanism. It only sets the policy requirement for future implementation stories.

## 11. Legacy Data Policy

Historical `workflow_runs.result_json` and wrap-up artifacts that already contain screenshot base64 should be treated as legacy data.

Decision:

1. No bulk migration in the first implementation wave.
2. New persistence paths must sanitize forward-only.
3. Historical base64 may remain in place as legacy data with documented rationale.
4. If a later migration story is created, it must define safety checks, compatibility behavior, and storage cleanup scope explicitly.

This avoids mixing design/policy work with a risky historical data rewrite.

## 12. Implementation Story Split And Sequencing

### Story 1: Screenshot Payload Contract

Owns:

1. Introduce canonical screenshot payload/container metadata
2. Add MIME-aware UI rendering
3. Render browser-use action screenshots live when present
4. Replace raw orchestrator screenshot base64 outputs with payload references/containers

Does not own:

1. persistence sanitization
2. retention cleanup
3. sensitive-phase gates beyond payload plumbing

### Story 2: Screenshot Persistence Sanitization

Owns:

1. Strip screenshot base64 before `workflow_runs.result_json`
2. Strip screenshot base64 before wrap-up artifact JSON
3. Persist path plus metadata only for durable evidence screenshots
4. Extend `session_screenshots` metadata if durable querying remains supported
5. Enforce fail-closed durable-write behavior when a workflow screenshot request lacks defined evidence-purpose metadata
6. Define any compatibility path needed for old durable screenshot artifacts after payload contract changes

Operational follow-ons attached to this story:

1. Add a validation rule in the governed workflow/story authoring path so new screenshot-bearing definitions must include the evidence-purpose metadata block before durable retention is allowed.
2. Keep `live_frame` payloads typed as non-durable by default across orchestrator and MCP runtime seams.
3. Emit a purge log that records counts of deleted ephemeral frames without logging frame content.
4. Evaluate whether a future `ttl_90d` or `ttl_audit` retention mode is necessary to manage long-lived retained evidence without changing the current `keep_until_manual_review` default.
5. Ensure the manual-review deletion path emits a signed audit record with who, when, and why for SIC-style evidence cleanup.

### Story 3: Sensitive Screenshot Gate

Owns:

1. Block screenshot capture during `pii_wait`
2. Block screenshot capture during sensitive-target steps
3. Gate `GET /api/screenshot`
4. Gate MCP screenshot capture
5. Emit screenshot block telemetry

### Story 4: Rolling And Debug Screenshot Cleanup

Owns:

1. Disable rolling screenshots by default unless debugging mode is enabled
2. Apply delete-on-success and TTL cleanup for debug artifacts
3. Keep rolling screenshots out of durable indexes unless future indexing policy is approved

Recommended sequence:

1. Payload Contract
2. Persistence Sanitization
3. Sensitive Screenshot Gate
4. Rolling And Debug Cleanup

Reason: payload and persistence decisions define the contract that the gates and cleanup logic must enforce.

## 13. Acceptance Matrix

| Branch | Class decision | Durable? | Base64 durable? | Sensitive-phase rule | Access/audit rule |
| --- | --- | --- | --- | --- | --- |
| Live UI WebSocket | `live_frame` | no | no | block | UI telemetry only |
| `GET /api/screenshot` | `live_frame` | no | no | block | require bound client/session + audit |
| Browser-use action screenshots | `live_frame` | no | no | block | render live only when MIME-aware |
| Workflow `screenshot` step | `evidence` by explicit policy | yes | no | block unless approved exception | workflow telemetry |
| Wrap-up / SQLite result persistence | metadata only | yes for evidence | no | sanitize before persistence | wrap-up telemetry |
| `session_screenshots` | metadata only | yes | no | no blocked capture indexed | repository metadata policy |
| Rolling screenshots | `debug_frame` | yes, short-lived | no | block | debug/retention telemetry |
| MCP `browser_screenshot` | `live_frame` | no | no | block | privileged capture + audit |
| Orchestrator screenshot tool | `live_frame` | no by default | no | block | orchestrator telemetry |
| Python bridge endpoints | inherited from caller | inherited | inherited | inherited | caller branch policy applies |

## 14. Final Design Decisions

1. Screenshots are classified artifacts, not neutral byproducts.
2. Durable screenshots are opt-in evidence artifacts by default.
3. Screenshot base64 is live-only by default and must not persist durably.
4. `pii_wait` and sensitive-target steps block screenshot capture by default.
5. `GET /api/screenshot` must require active bound UI session/client validation.
6. MCP screenshot capture is privileged, gated, and audited.
7. Durable evidence screenshots require encryption at rest by default.
8. Historical base64 remains legacy data; new writes sanitize forward-only.
