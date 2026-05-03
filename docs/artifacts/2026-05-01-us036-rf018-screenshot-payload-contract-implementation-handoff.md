# Screenshot Payload Contract — Implementation Handoff

Story: `US-036`
Tracker Row: `RF-018`
Source Policy Story: `US-035 / RF-017`

## Forge System Instructions

Use the Forge system and Forge build loop explicitly.

1. Read `US-035` policy design before implementing.
2. Keep this story scoped to payload contract and MIME-aware live rendering.
3. Do not implement persistence sanitization, sensitive-phase gates, or cleanup in this story.
4. Run focused tests plus typecheck before closeout.
5. Record Summary of Work in `progress.txt`, and update PRD/tracker/history on completion.

## Task

Implement Story 1 from the screenshot security policy design: Screenshot Payload Contract.

Required changes:

1. Add `ScreenshotPayload` metadata contract.
2. Add screenshot payload to live UI screenshot events while preserving `screenshotBase64`.
3. Render screenshot payloads with their `mimeType`.
4. Render browser-use action screenshots live when present.
5. Infer browser-use action screenshot MIME type from base64 signatures.
6. Replace orchestrator screenshot raw base64 output values with JSON screenshot payload containers.
7. Add focused tests for bridge MIME inference, orchestrator payload output, and UI rendering contract.

## Non-Goals

- no DB migrations
- no persisted base64 cleanup
- no screenshot file deletion
- no sensitive-phase screenshot blocking
- no rolling screenshot retention changes

