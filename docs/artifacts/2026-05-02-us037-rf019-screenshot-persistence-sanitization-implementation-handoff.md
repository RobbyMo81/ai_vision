# US-037 / RF-019 Implementation Handoff

## Agent Prompt

You are implementing `US-037 / RF-019: Screenshot Persistence Sanitization` in the ai-vision repository. Follow the Forge workflow exactly.

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
- `docs/debriefs/2026-05-01-screenshot-workflow-investigation-scratch-pad.md`

## Build Target

Implement forward-only screenshot persistence sanitization. New durable workflow writes must not embed screenshot base64 in:

1. `workflow_runs.result_json`;
2. wrap-up artifact JSON.

The runtime `WorkflowResult` should remain compatible for in-process callers. Sanitize at durable write boundaries instead of stripping data prematurely from live runtime objects.

## Expected Code Areas

Inspect these files first:

- `src/workflow/wrap-up.ts`
- `src/db/repository.ts`
- `src/workflow/types.ts`
- `src/session/types.ts`
- `src/db/migrations/002_workflow_runs.sql`
- existing tests near repository, wrap-up, workflow, and orchestrator persistence behavior

Use existing local patterns. Do not add a broad abstraction unless it clearly reduces duplicate sanitization logic at durable write boundaries.

## Required Behavior

1. `stepResults[].screenshotBase64` must be absent from newly persisted `workflow_runs.result_json`.
2. `screenshots[].base64` must be absent from newly written wrap-up artifact JSON.
3. Sanitized screenshot records should preserve non-byte evidence fields, especially path and step id.
4. Where a `ScreenshotPayload` exists, preserve canonical metadata:
   - `source`
   - `class`
   - `mimeType`
   - `sensitivity`
   - `retention`
   - `persistBase64: false`
5. If older runtime structures lack some metadata, do not invent misleading values. Prefer explicit defaults already defined by `US-036` or omit unavailable fields.
6. Historical rows and artifacts that already contain base64 remain legacy data. Do not bulk-migrate them.
7. Keep `session_screenshots` path-only unless an existing durable query path proves a minimal metadata extension is necessary.

## Explicit Non-Goals

Do not implement:

- sensitive-phase capture blocking;
- `/api/screenshot` active client/session binding;
- MCP screenshot access control or audit enforcement;
- rolling/debug screenshot cleanup;
- signed manual-review deletion logs;
- encryption-at-rest;
- historical data migration;
- fail-closed workflow authoring validation for missing evidence-purpose metadata.

## Testing Requirements

Add or update focused tests that prove:

1. repository persistence omits screenshot base64 from `result_json`;
2. wrap-up artifact JSON omits screenshot base64;
3. path and available screenshot metadata remain present after sanitization;
4. runtime result shape remains usable before persistence.

Run:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand <focused test files>
```

Run full `pnpm test` if the implementation touches shared workflow or repository contracts broadly.

## Closeout

When implementation is complete:

1. mark `US-037` complete in `prd.json`;
2. mark `RF-019` complete in `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`;
3. append a full history entry to `docs/history/forge_history.md`;
4. append a library-card row to `docs/history/history_index.md`;
5. update `progress.txt` with Summary of Work, files touched, acceptance criteria, and validation results;
6. write Forge memory story state and useful discoveries.
