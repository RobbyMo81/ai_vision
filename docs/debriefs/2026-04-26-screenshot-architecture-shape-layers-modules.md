# Screenshot Architecture: Shape, Layers, and Modules

Date: 2026-04-26  
Scope: Read-only architecture investigation of how screenshots are captured, transported, stored, and consumed.

## Executive Summary

The screenshot subsystem is implemented as a multi-path pipeline with three main storage/transport forms:

1. In-memory base64 transport for live UI updates and tool outputs
2. Filesystem image artifacts (rolling/session/workflow/bridge outputs)
3. SQLite persistence of paths and workflow result JSON

The design favors operational flexibility (live HITL visibility + durable run artifacts) over a single canonical screenshot pathway.

Operationally, the current system can also be summarized as:

- 4 architectural layers
- 3 main storage/transport branches
- 5 primary screenshot capture sources
- 4 concrete durable storage locations
- multiple consumers across UI, HTTP, MCP, workflow persistence, and agentic orchestration

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

## Operational Inventory

### Who Uses Screenshot Data

The screenshot data is consumed by the following runtime and persistence surfaces:

1. HITL web UI websocket client
  - Receives `type: 'screenshot'` payloads with `screenshotBase64` and renders them for the operator.
  - Source modules: `src/ui/server.ts`, `src/session/types.ts`

2. HITL HTTP polling client
  - Calls `GET /api/screenshot` and receives `{ base64, url }` for manual refresh / browser-state visibility.
  - Source module: `src/ui/server.ts`

3. MCP clients
  - Use the `browser_screenshot` tool and receive image content directly from the current browser page.
  - Source module: `src/mcp/server.ts`

4. Workflow runtime and wrap-up persistence
  - The workflow `screenshot` step emits `screenshotPath` and `screenshotBase64`, and the full workflow result carries screenshot arrays into durable run artifacts.
  - Source modules: `src/workflow/engine.ts`, `src/workflow/wrap-up.ts`

5. Session and workflow history readers
  - Session history reads normalized screenshot paths from SQLite, and workflow history reads result JSON that may contain screenshot payloads.
  - Source modules: `src/db/repository.ts`

6. Agentic orchestrator state/output flow
  - The orchestrator screenshot tool captures page state and can store screenshot base64 under workflow outputs for later tool or completion use.
  - Source module: `src/orchestrator/loop.ts`

### How Many Locations Store Screenshots

There are two valid counts depending on whether the question is about architectural branches or concrete durable storage targets.

#### A. Main storage/transport branches: 3

1. In-memory base64 transport
  - Used for live websocket updates, HTTP screenshot responses, MCP image responses, and orchestrator output variables.

2. Filesystem image artifacts
  - Used for rolling session frames, workflow screenshot files, and Python bridge screenshot outputs.

3. SQLite persistence
  - Used for normalized screenshot path storage and workflow result JSON persistence.

#### B. Concrete durable storage locations: 4

1. Filesystem image files
  - Rolling screenshot frames under `sessions/rolling` or `SESSION_DIR/rolling`
  - Workflow screenshot artifacts under `SESSION_DIR/workflow`
  - Bridge-produced screenshot image files from Python endpoints

2. `session_screenshots` table
  - Normalized path storage keyed by session
  - Source modules: `src/db/migrations/001_init.sql`, `src/db/repository.ts`

3. `workflow_runs.result_json`
  - Denormalized workflow result blob that may include screenshot arrays and related metadata
  - Source modules: `src/db/migrations/002_workflow_runs.sql`, `src/db/repository.ts`

4. Wrap-up artifact JSON files
  - Filesystem wrap-up records that persist the final workflow result/state/session context, including screenshot references carried in `result`
  - Source module: `src/workflow/wrap-up.ts`

### Who Takes Screenshots

There are 5 primary screenshot capture sources in the current system.

1. Shared Playwright session manager capture
  - `sessionManager.screenshot()` returns a base64 JPEG for direct runtime use.
  - Source module: `src/session/manager.ts`

2. Session manager rolling screenshot timer
  - `startScreenshotTimer()` periodically captures JPEG frames and writes them to disk.
  - Source module: `src/session/manager.ts`

3. Workflow `screenshot` step
  - The direct workflow engine calls `sessionManager.screenshot()`, writes a workflow artifact file, and appends screenshot metadata to the run result.
  - Source module: `src/workflow/engine.ts`

4. Orchestrator screenshot tool
  - The agentic tool surface captures PNG directly from the page and stores base64 in workflow outputs.
  - Source module: `src/orchestrator/loop.ts`

5. Python bridge screenshot endpoint
  - Python automation servers capture PNG to a path and return `{ path, base64, taken_at }`, which TypeScript maps into the runtime `Screenshot` type.
  - Source modules: `src/engines/browser-use/server/main.py`, `src/engines/python-bridge.ts`

If the question is interpreted as who triggers capture rather than who owns the capture implementation, the trigger surfaces are broader:

- HITL screenshot push loop in `src/ui/server.ts`
- HITL screenshot HTTP endpoint in `src/ui/server.ts`
- MCP `browser_screenshot` tool in `src/mcp/server.ts`
- direct workflow `screenshot` steps in `src/workflow/engine.ts`
- orchestrator screenshot tool calls in `src/orchestrator/loop.ts`
- rolling timer activation in `src/session/manager.ts`
- Python bridge `/screenshot` calls in `src/engines/python-bridge.ts`

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
