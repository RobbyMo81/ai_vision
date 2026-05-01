# Screenshot Architecture: Shape, Layers, and Modules

Date: 2026-04-26  
Scope: Read-only architecture investigation of how screenshots are captured, transported, stored, and consumed.

## Executive Summary

The screenshot subsystem is implemented as a multi-path pipeline with three main storage/transport forms:

1. In-memory base64 transport for live UI updates and tool outputs
2. Filesystem image artifacts (rolling/session/workflow/bridge outputs)
3. SQLite persistence of paths and workflow result JSON

The design favors operational flexibility (live HITL visibility + durable run artifacts) over a single canonical screenshot pathway.

## End-to-End Shape

### 1) Capture Sources

- Shared Playwright session manager captures JPEG base64 snapshots for direct runtime usage.
- Session manager rolling timer captures periodic JPEG frames and writes them to disk.
- Workflow screenshot step captures base64 then writes a workflow artifact file.
- Orchestrator screenshot tool captures PNG and stores base64 in output variables.
- Python bridge screenshot endpoint captures PNG to disk and returns path + base64 + timestamp.

### 2) Runtime Transport

- HITL websocket payload supports screenshot events with screenshotBase64.
- During HITL takeover, UI server starts a periodic screenshot push loop.
- HTTP polling endpoint also exposes current screenshot base64 + current URL.

### 3) Persistence

- Session-level screenshot paths are inserted into session_screenshots.
- Workflow-level full run output (including screenshot arrays when present) is persisted in workflow_runs.result_json.
- Wrap-up also writes a filesystem JSON artifact with result/state/session context.

## Layered Model

## Layer A: Capture Engines

Primary module responsibilities:

- src/session/manager.ts
  - screenshot(): returns base64 JPEG
  - startScreenshotTimer(): writes rolling frames under sessions/rolling (or SESSION_DIR/rolling)
- src/workflow/engine.ts
  - screenshot step captures via SessionManager, writes workflow file, records metadata in step result
- src/orchestrator/loop.ts
  - screenshot tool captures PNG from page and stores base64 in outputs[output_key]
- src/engines/browser-use/server/main.py + src/engines/python-bridge.ts
  - /screenshot captures PNG to path and returns { path, base64, taken_at }, mapped to TS Screenshot

## Layer B: Session State and UI Transport

- src/session/types.ts
  - HitlEventPayload includes type: 'screenshot' and optional screenshotBase64
- src/ui/server.ts
  - startScreenshotPush() periodically captures screenshot and broadcasts websocket screenshot events
  - GET /api/screenshot returns current base64 screenshot and URL

## Layer C: Workflow Runtime Semantics

- src/workflow/engine.ts
  - screenshot sub-step emits both screenshotPath and screenshotBase64 into step result
  - screenshot artifacts are included in workflow result payload

## Layer D: Durable Storage and Wrap-Up

- src/db/migrations/001_init.sql
  - session_screenshots table stores { session_id, path, taken_at }
- src/db/repository.ts
  - save() writes result.screenshots paths into session_screenshots
  - list() aggregates screenshot paths back per session
- src/db/migrations/002_workflow_runs.sql + src/db/repository.ts
  - workflow_runs.result_json stores full workflow result blob
- src/workflow/wrap-up.ts
  - saveWorkflowRun(resultJson)
  - writes wrap-up artifact JSON to memory wrap-ups directory

## Data Shapes

Canonical runtime screenshot type:

- src/engines/interface.ts
  - Screenshot: { path: string, base64?: string, takenAt: Date }

HITL event screenshot type:

- src/session/types.ts
  - HitlEventPayload.screenshotBase64?: string

Bridge screenshot payload mapping:

- Python: { path, base64, taken_at }
- TypeScript: { path, base64, takenAt: Date }

## Observed Design Characteristics

1. Multiple intentional pathways
- Live UX path: websocket/http base64 streaming
- Artifact path: filesystem files + DB path indexing
- Agent bridge path: Python-produced PNG payloads

2. Mixed image formats by producer
- Session manager paths use JPEG
- Orchestrator and Python bridge paths use PNG

3. Hybrid persistence strategy
- Normalized table for session screenshot paths
- Denormalized workflow result JSON for run completeness

## Risks and Gaps to Watch

1. Pathway duplication can drift
- Similar screenshot responsibilities exist in SessionManager, workflow engine, orchestrator loop, and bridge server.

2. Storage consistency is not fully unified
- Some paths store only file references; others retain base64 inside result payloads.

3. Format heterogeneity may impact downstream processing
- JPEG and PNG coexist, which can complicate uniform post-processing assumptions.

## Suggested Follow-Up (Optional)

If consolidation is desired, a future refactor can define a single screenshot service contract:

- one canonical capture API
- one normalized metadata schema
- configurable retention for base64 vs file-only storage
- explicit policy for live transport vs archival persistence
