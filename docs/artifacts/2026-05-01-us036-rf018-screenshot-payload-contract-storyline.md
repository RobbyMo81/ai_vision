# Screenshot Payload Contract

Story: `US-036`
Tracker Row: `RF-018`
Date: `2026-05-01`

## Problem

The screenshot security policy design in `US-035 / RF-017` establishes that later screenshot gates and persistence cleanup need one shared payload contract first. The current runtime still mixes raw base64 strings, hardcoded JPEG UI rendering, browser-use action screenshots with no MIME metadata, and orchestrator screenshot outputs stored as raw base64.

Without a shared payload shape, later persistence and sensitive-phase stories would have to infer source, MIME type, retention, and sensitivity from ad hoc fields.

## Mission

Implement the first runtime slice from the screenshot security policy design: a canonical live screenshot payload/container contract and MIME-aware UI rendering.

## Scope

This story must:

- introduce canonical screenshot payload/container metadata
- make live screenshot websocket payloads carry the new container while keeping backward compatibility with `screenshotBase64`
- infer MIME type for browser-use action screenshots when possible
- render browser-use action screenshots live when present
- update the browser UI screenshot helper to use MIME type instead of hardcoded JPEG
- replace raw orchestrator screenshot output base64 with a JSON screenshot payload container
- add focused regression tests

This story must not:

- strip persisted base64 from workflow run or wrap-up artifacts
- add database migrations
- implement sensitive-phase screenshot gates
- delete or clean up screenshot files
- change rolling screenshot retention

## Source Evidence

- `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design.md`
- `docs/debriefs/2026-05-01-screenshot-workflow-investigation-scratch-pad.md`
- `src/session/types.ts`
- `src/ui/server.ts`
- `src/engines/python-bridge.ts`
- `src/orchestrator/loop.ts`

## Outcome Required

At the end of this story, live screenshot-bearing boundaries should have a shared container shape and MIME-aware rendering. Follow-on persistence and sensitive gate stories can then enforce policy against the new metadata instead of raw base64 strings.

