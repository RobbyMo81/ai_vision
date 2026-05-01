# Screenshot Architecture Findings Investigation

Date: 2026-05-01
Source: `docs/debriefs/2026-04-26-screenshot-architecture-shape-layers-modules.md`
Scope: Read-only follow-up investigation of findings that could imply immediate defects.

## Executive Summary

The screenshot architecture debrief is accurate about the system shape: screenshot data moves through live base64 transport, filesystem artifacts, and SQLite-backed records. The immediate investigation found one concrete behavior gap and two architectural risks that should become governed hardening work rather than emergency runtime patches.

## Finding 1: Browser-use Action Screenshots Are Captured But Not Rendered By The UI

Status: confirmed gap
Severity: medium

Evidence:

- Browser-use step callbacks include `screenshot_b64` from `browser_state_summary.screenshot` in `src/engines/browser-use/server/main.py`.
- TypeScript maps that field to `BrowserUseActionEvent.screenshotBase64` in `src/engines/python-bridge.ts`.
- The UI server broadcasts `browser_use_action` events with the full `browserUseEvent` in `src/ui/server.ts`.
- The browser UI logs `browser_use_action` events but only calls `showScreenshot(...)` for payloads whose top-level `type` is `screenshot`.

Impact:

Live browser-use action events can carry screenshots, but the HITL UI does not render those per-step images. Operator screenshot visibility still works through the separate `/api/screenshot` polling path and HITL screenshot push loop, so this is not a total screenshot outage. It is a drift between the browser-use event payload shape and the UI rendering contract.

Recommended follow-up:

Create a small UI hardening story to render `payload.browserUseEvent.screenshotBase64` when present, with a MIME-aware image helper. Add a regression test proving browser-use action screenshots update the visible screenshot panel.

## Finding 2: Screenshot Result JSON Persists Base64 Payloads

Status: confirmed design risk
Severity: medium

Evidence:

- Direct workflow screenshot steps push `{ path, base64, stepId }` into `WorkflowResult.screenshots` in `src/workflow/engine.ts`.
- `WorkflowResult.screenshots` is typed as `Array<{ path: string; base64: string; stepId: string }>` in `src/workflow/types.ts`.
- Wrap-up persists `JSON.stringify(input.result)` into `workflow_runs.result_json` in `src/workflow/wrap-up.ts`.
- Wrap-up also writes the full artifact JSON containing `result` to the memory wrap-up artifact directory.

Impact:

Every workflow screenshot can be duplicated as both a filesystem image and base64 inside SQLite/result artifacts. This is operationally flexible but creates predictable database/artifact growth and can make later history reads heavier than necessary.

Recommended follow-up:

Define retention policy explicitly: live transport may keep base64, but durable workflow results should prefer path plus metadata unless a story requires embedded image data. If base64 retention remains intentional, add a documented size/retention budget.

## Finding 3: Format And MIME Handling Are Not Canonical

Status: confirmed architectural risk
Severity: low to medium

Evidence:

- `SessionManager.screenshot()` returns JPEG base64.
- The workflow screenshot step writes those bytes to `.jpg`.
- The MCP `browser_screenshot` tool returns `image/jpeg`.
- The orchestrator screenshot tool captures PNG and stores raw base64 in outputs.
- Browser-use bridge screenshot endpoints write `.png`.
- The HITL web UI `showScreenshot(...)` always prefixes `data:image/jpeg;base64,`.

Impact:

The current UI image path is safe for SessionManager screenshots because they are JPEG. It will be wrong for any future path that tries to render browser-use or orchestrator PNG base64 through the same helper without adding MIME metadata.

Recommended follow-up:

Introduce a small `ScreenshotPayload` shape for UI transport: `{ base64, mimeType, source, takenAt? }`. Keep JPEG as the default for SessionManager but stop hardcoding the MIME type in generic UI rendering.

## Finding 4: Rolling Screenshots Are Artifact-Only

Status: confirmed, not a defect
Severity: low

Evidence:

- `startScreenshotTimer(...)` writes rolling JPEG frames under `SESSION_DIR/rolling` or `sessions/rolling`.
- It emits `session.screenshot.rolling` telemetry with file path and URL.
- It does not insert rolling frame paths into `session_screenshots`.
- `session_screenshots` is populated from saved task/workflow result screenshot arrays.

Impact:

The debrief's statement that SQLite stores screenshot paths is true for task/workflow result screenshots, not for every rolling frame. That distinction should be preserved in future docs so agents do not assume rolling captures are queryable from `session_screenshots`.

Recommended follow-up:

No immediate code change. If rolling-frame history becomes user-facing, add a retention/indexing story rather than silently writing every rolling frame into SQLite.

## Suggested Story Seeds

1. UI screenshot payload contract hardening
   - Render browser-use action screenshot payloads when present.
   - Add MIME metadata to screenshot websocket events.
   - Replace hardcoded `data:image/jpeg` in the generic UI helper.

2. Durable screenshot retention policy
   - Decide whether workflow result JSON should retain base64.
   - If not, persist file path plus metadata and keep base64 only for live transport/tool outputs.
   - Add migration/backward-compatibility notes for old result JSON.

3. Rolling screenshot indexing policy
   - Decide whether rolling frames are telemetry-only artifacts or queryable session history.
   - If queryable, define retention limits before indexing them.

## Validation

No runtime code changed. This investigation used source inspection only.

