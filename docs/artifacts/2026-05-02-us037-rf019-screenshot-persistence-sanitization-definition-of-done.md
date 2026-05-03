# US-037 / RF-019 Definition Of Done

## Done Means

`US-037 / RF-019` is done when new durable workflow persistence no longer stores screenshot base64 in SQLite result JSON or wrap-up artifact JSON, while retaining path plus metadata for durable screenshot evidence and preserving the runtime `WorkflowResult` shape for live callers.

## Required Outcomes

1. New `workflow_runs.result_json` writes omit `stepResults[].screenshotBase64`.
2. New wrap-up artifact JSON writes omit `screenshots[].base64`.
3. Durable screenshot records preserve path and step id when available.
4. Durable screenshot records preserve canonical screenshot metadata when available:
   - `source`
   - `class`
   - `mimeType`
   - `sensitivity`
   - `retention`
   - `persistBase64: false`
5. Runtime `WorkflowResult` objects are not stripped before live callers can use them.
6. `session_screenshots` remains path-only unless a minimal metadata extension is justified by an existing durable query path.
7. Historical rows and artifacts with embedded base64 are documented as legacy data and are not bulk-migrated.
8. Sensitive gates, access gates, MCP audit, rolling cleanup, encryption, manual-review deletion logs, and fail-closed authoring validation remain out of scope.

## Required Tests

Focused tests must prove:

1. repository persistence strips screenshot base64 from result JSON;
2. wrap-up artifact persistence strips screenshot base64 from artifact JSON;
3. sanitized records retain path and available metadata;
4. runtime result compatibility is preserved before persistence.

## Required Validation

The implementing agent must run and record:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand <focused test files>
```

If shared workflow or repository contracts are touched broadly, run and record full `pnpm test`.

## Governance Closeout

The implementing agent must update:

1. `prd.json`
2. `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
3. `progress.txt`
4. `docs/history/forge_history.md`
5. `docs/history/history_index.md`
6. Forge memory story state

The final response must include Summary of Work, files touched, acceptance criteria, and final validation result.
