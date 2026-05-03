# US-038 / RF-020 Implementation Handoff

## Agent Prompt

You are implementing `US-038 / RF-020: Screenshot Capture Policy Gate` in the ai-vision repository. Follow the Forge workflow exactly.

Before editing code:

1. read `FORGE.md`;
2. read `AGENTS.md`;
3. read `prd.json`;
4. read `progress.txt`;
5. query Forge memory for current story state and unread messages;
6. read the source artifacts listed below.

Source artifacts:

- `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design.md`
- `docs/artifacts/2026-05-01-us036-rf018-screenshot-payload-contract-storyline.md`
- `docs/artifacts/2026-05-02-us037-rf019-screenshot-persistence-sanitization-storyline.md`
- `docs/debriefs/2026-05-01-screenshot-workflow-investigation-scratch-pad.md`
- `docs/artifacts/2026-04-26-us024-rf006-confirmation-preflight-definition-of-done.md`

## Build Target

Implement a capture-time screenshot policy gate. The gate must decide whether each screenshot request is allowed, redacted, step-scoped and deleted on step advance, blocked with structured next-action metadata, or treated as explicit evidence.

The point is not to blind the agent. The point is to prevent uncontrolled pixel exposure while still giving the agent a clear next action.

## Expected Code Areas

Inspect these first:

- `src/session/types.ts`
- `src/session/manager.ts`
- `src/session/hitl.ts`
- `src/ui/server.ts`
- `src/mcp/server.ts`
- `src/workflow/engine.ts`
- `src/workflow/types.ts`
- `src/workflow/wrap-up.ts`
- `src/telemetry/manager.ts`
- existing tests near UI server, MCP server, session manager, workflow engine, and wrap-up

Prefer a small shared policy helper or equivalent local contract over ad hoc gates in each endpoint.

## Required Behavior

1. Classify screenshot capture requests as `live_frame`, `debug_frame`, `step_scoped`, `evidence`, or `sensitive_blocked`.
2. Use current phase, step id, field/target sensitivity metadata, source, and session context to decide.
3. During `pii_wait`, deny screenshot bytes unless a safe redaction path exists.
4. During sensitive-target steps, redact/mask known sensitive regions before capture when feasible.
5. If redaction cannot be applied safely, fail closed with structured denial metadata.
6. For temporary agent context, allow `step_scoped` screenshots and delete their bytes/temp files on workflow step advance.
7. Gate `GET /api/screenshot` with active session/client binding using the `US-024` pattern.
8. Gate MCP screenshot capture with the same policy contract.
9. Pause, deny, or step-scope rolling/live screenshots during sensitive phases.
10. Emit telemetry for allowed, redacted, blocked, and step-TTL-deleted screenshots without image bytes.
11. Preserve `US-036` payload compatibility and `US-037` durable persistence sanitization.

## Structured Denial Shape

Blocked responses should return no pixels and should include:

```json
{
  "screenshot": {
    "class": "sensitive_blocked",
    "sensitivity": "blocked",
    "persistBase64": false,
    "blockedReason": "pii_wait_active",
    "nextAction": "retry_after_sensitive_phase"
  }
}
```

Use exact field names that fit the repo's TypeScript contracts, but keep this semantic shape.

## Step-Scoped TTL Shape

Temporary screenshots should carry metadata equivalent to:

```json
{
  "class": "step_scoped",
  "retention": "step_scoped",
  "expiresOnStepAdvance": true,
  "persistBase64": false
}
```

On workflow step advance, delete the bytes/temp file and emit deletion telemetry with counts/metadata only.

## Explicit Non-Goals

Do not implement:

- historical screenshot migration;
- durable evidence encryption-at-rest;
- full rolling/debug cleanup TTL beyond step-scoped deletion;
- signed manual-review evidence deletion logs;
- broad `session_screenshots` metadata normalization;
- agentic/orchestrator output guard rail unless `mode: agentic` remains in production screenshot use.

## Testing Requirements

Add focused tests proving:

1. `pii_wait` screenshot capture returns no pixels and includes structured next action.
2. sensitive-target capture redacts/masks known sensitive regions or fails closed.
3. step-scoped screenshots are deleted on step advance.
4. `GET /api/screenshot` rejects stale, mismatched, and unbound clients.
5. MCP screenshot capture uses the same policy contract.
6. telemetry records allow/redact/block/delete decisions without image bytes.
7. existing US-036 and US-037 behavior remains compatible.

Run:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand <focused test files>
```

Run full `pnpm test` if shared screenshot/session contracts are touched broadly.

## Closeout

When implementation is complete:

1. mark `US-038` complete in `prd.json`;
2. mark `RF-020` complete in `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`;
3. append a full history entry to `docs/history/forge_history.md`;
4. append a library-card row to `docs/history/history_index.md`;
5. update `progress.txt` with Summary of Work, files touched, acceptance criteria, and validation results;
6. write Forge memory story state and useful discoveries.
