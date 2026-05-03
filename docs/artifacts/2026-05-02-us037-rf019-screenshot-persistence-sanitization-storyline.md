# US-037 / RF-019: Screenshot Persistence Sanitization Storyline

## Forge Directive

Use the Forge build loop for this story. Read `FORGE.md`, `AGENTS.md`, `prd.json`, `progress.txt`, the Forge memory state, and the linked screenshot policy artifacts before writing code. Keep the implementation bounded to forward-only durable persistence sanitization.

## Story

As the ai-vision workflow platform, I need screenshot payloads sanitized before durable result persistence so screenshot bytes do not accumulate in SQLite or wrap-up JSON artifacts after a successful or failed workflow.

The runtime now has a canonical `ScreenshotPayload` contract from `US-036` / `RF-018`. This story applies that contract at durable storage boundaries. The system should keep enough metadata to locate and reason about durable evidence screenshots, but it must not embed screenshot base64 in `workflow_runs.result_json` or wrap-up artifact JSON.

## Problem

Screenshots can contain sensitive page pixels, private account context, regulated evidence, and postcondition state. Before the screenshot security policy work, multiple paths could carry screenshot base64 through workflow result structures. If those structures are persisted unchanged, the platform stores duplicate screenshot bytes in both file artifacts and JSON persistence surfaces.

That creates two risks:

1. security risk, because screenshot pixels bypass text redaction and may contain sensitive information;
2. storage growth risk, because the same screenshot can be retained as both an image file and embedded base64 inside durable JSON.

## Scope

Implement forward-only sanitization for new durable writes.

The story owns:

1. strip `stepResults[].screenshotBase64` before persisting `workflow_runs.result_json`;
2. strip `screenshots[].base64` before writing wrap-up artifact JSON;
3. preserve screenshot path, step id, and canonical metadata when a durable screenshot record is retained;
4. add durable metadata fields where needed: `source`, `class`, `mimeType`, `sensitivity`, `retention`, and `persistBase64: false`;
5. keep the runtime `WorkflowResult` returned to callers unchanged;
6. keep `session_screenshots` path-only in this story unless a minimal metadata extension is required by an existing durable query path;
7. document historical result JSON with embedded base64 as legacy data, with no bulk migration in this slice;
8. add regression coverage proving durable JSON omits screenshot base64 while preserving useful screenshot metadata.

## Out Of Scope

Do not implement these in this story:

1. sensitive-phase screenshot gates;
2. `/api/screenshot` active client/session binding;
3. MCP screenshot access gates or audit enforcement;
4. rolling/debug screenshot cleanup;
5. signed manual-review deletion records;
6. durable evidence encryption-at-rest implementation;
7. historical data migration or cleanup;
8. fail-closed workflow authoring validation for missing evidence-purpose metadata.

Those items remain follow-on work from the screenshot security policy design.

## References

- `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design.md`
- `docs/artifacts/2026-05-01-us036-rf018-screenshot-payload-contract-storyline.md`
- `docs/debriefs/2026-05-01-screenshot-workflow-investigation-scratch-pad.md`
- `src/workflow/wrap-up.ts`
- `src/db/repository.ts`
- `src/workflow/types.ts`
- `src/session/types.ts`

## Exit

Exit only when new workflow persistence writes cannot store screenshot base64 in SQLite result JSON or wrap-up artifact JSON, screenshot metadata remains queryable enough for durable evidence, runtime results remain compatible for callers, and validation passes.
