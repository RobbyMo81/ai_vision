# US-038 / RF-020: Screenshot Capture Policy Gate Storyline

## Forge Directive

Use the Forge build loop for this story. Read `FORGE.md`, `AGENTS.md`, `prd.json`, `progress.txt`, Forge memory state, and the linked screenshot policy artifacts before writing code. This is a runtime policy-gate story.

## Story

As the ai-vision workflow platform, I need every screenshot capture request to pass through one policy decision before pixels leave the browser so screenshots are either allowed, redacted, step-scoped, blocked with structured next-action metadata, or persisted only as explicit evidence.

## Problem

`US-036` gave screenshots a payload contract, and `US-037` removed screenshot bytes from durable direct workflow persistence. The remaining runtime risk is capture-time behavior: live UI, workflow steps, MCP, rolling/debug capture, and sensitive phases still need one decision point that chooses between:

1. allow as transient context;
2. redact sensitive regions before capture;
3. expire the screenshot immediately when the workflow advances to the next step;
4. block capture and return a structured denial;
5. persist only explicit evidence screenshots with path plus metadata.

Blocking every sensitive screenshot is too blunt because the agent may still need visual context. Allowing every screenshot is unsafe because pixels can contain PII, credentials, payment data, private account pages, or regulated evidence. The policy gate must make the decision explicit and machine-readable.

## Scope

Implement a screenshot capture policy gate for active runtime capture paths.

The story owns:

1. classify capture requests into `live_frame`, `debug_frame`, `step_scoped`, `evidence`, or `sensitive_blocked`;
2. evaluate current workflow phase, current step id, field/target sensitivity metadata, and capture source before allowing pixels;
3. block or structured-deny screenshots during `pii_wait` unless an approved redaction path exists;
4. redact or mask known sensitive DOM regions before screenshot capture when enough metadata exists to do so safely;
5. fail closed or return HITL/next-action metadata if redaction cannot be applied;
6. add step-scoped TTL behavior so temporary agent-context screenshots are deleted on workflow step advance;
7. gate `GET /api/screenshot` with active session/client binding using the proven `US-024` style binding pattern;
8. gate MCP screenshot capture through the same policy contract;
9. pause, deny, or step-scope rolling/live screenshot capture during sensitive phases;
10. emit telemetry for allow, redact, step-TTL deletion, and block decisions without logging screenshot bytes;
11. return structured denial payloads that tell the agent the safe next action.

## Out Of Scope

Do not implement these in this story:

1. historical screenshot migration;
2. encryption-at-rest for durable evidence screenshots;
3. full rolling/debug cleanup TTL beyond step-scoped deletion required by this gate;
4. signed manual-review evidence deletion records;
5. broad `session_screenshots` metadata normalization;
6. agentic/orchestrator output guard rail unless `mode: agentic` remains in production screenshot use.

## Runtime Contract

Allowed screenshot payloads must include enough metadata for policy enforcement:

- `source`
- `class`
- `mimeType`
- `sensitivity`
- `retention`
- `persistBase64: false`
- `sessionId`, `workflowId`, and `stepId` when available

Blocked screenshot responses must include:

- `class: sensitive_blocked`
- `sensitivity: blocked`
- `blockedReason`
- `nextAction`
- safe context such as phase and step id when available
- no screenshot bytes

Step-scoped screenshots must include:

- `class: step_scoped`
- `retention: step_scoped`
- `expiresOnStepAdvance: true`
- deletion telemetry on step advance
- no durable base64

## References

- `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design.md`
- `docs/artifacts/2026-05-01-us036-rf018-screenshot-payload-contract-storyline.md`
- `docs/artifacts/2026-05-02-us037-rf019-screenshot-persistence-sanitization-storyline.md`
- `docs/debriefs/2026-05-01-screenshot-workflow-investigation-scratch-pad.md`
- `docs/artifacts/2026-04-26-us024-rf006-confirmation-preflight-definition-of-done.md`

## Exit

Exit only when screenshot capture decisions are centralized enough that sensitive phases cannot leak pixels, non-sensitive screenshots can be step-scoped and deleted on step advance, redaction is applied or capture fails closed when sensitive regions are known, UI/MCP access is bound to active context, and tests prove the allow/redact/block/delete behavior.
