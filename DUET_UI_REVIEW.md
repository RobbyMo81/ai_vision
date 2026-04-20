# Diagnostic Duet UI Review
**Date**: March 22, 2026  
**Status**: Production-ready with telemetry instrumentation

## Architecture Overview

### Core Components
The Duet UI is a TypeScript/Vite single-page application with 8 interactive panels:

1. **RunSelector** - Host/run selection with filtering
2. **QuartetView** - Family database diagnostic results
3. **TrioView** - Rust/Python layered analysis results
4. **AgentContextWindow** - Agent-readable evidence summary
5. **AgentChatPanel** - Interactive agent assistant
6. **DriftPanel** - Configuration drift tracking
7. **TokenDashboard** - Token usage metrics
8. **JournalTimeline** - Operation audit trail

### Tech Stack
- **Framework**: Vanilla TypeScript (no React/Vue)
- **Build**: Vite v6.4.1
- **Testing**: Vitest (with SQLite3 native module)
- **Styling**: CSS Grid with neutral color palette (#f4f1ea background)

## Current Features

### Data Flow
```
API Middleware (logger → telemetry sink)
    ↓
Vite Dev Server (http://localhost:5173)
    ↓
UI Panels (mount to #app grid layout)
    ↓
Telemetry Events (JSON JSONL sink or console)
```

### API Endpoints (from vite.config.ts middleware)
- `/api/runs` - List diagnostic runs
- `/api/findings` - Evidence/findings per run
- `/api/artifacts` - Artifacts (configs, logs, etc.)
- `/api/drift` - Historical drift records
- `/api/tokens` - Token usage ledger
- `/api/token-trend` - Token trend analysis
- `/api/journal` - JournalEntry timeline

### Telemetry Instrumentation
**Events emitted:**
- `ui.mount` - UI initialization
- `runs.load.succeeded` / `runs.load.failed` - Run fetching
- `run.selected` - User selects run
- `panels.load.failed` - Panel rendering errors
- `api.request` / `api.response` - API request/response with correlation IDs

**Sink Configuration:**
- Default: `.Diagnostic_Quartet/duet-events.jsonl` (rotated JSONL)
- Override: `DUET_EVENT_LOG_PATH=/abs/path/events.jsonl`
- Retention: 700 MB–1 GB (configurable via `DUET_TELEMETRY_MIN_MB` / `DUET_TELEMETRY_MAX_MB`)
- Invalid config: Falls back to console-only logging + `telemetry.sink.invalid_config` event

## Recent Enhancements (this session)

### ✅ Telemetry Addition
- Structured JSON event logging from UI lifecycle (`ui.mount`, `ui.error`, panel loads)
- Agent-readable telemetry module: `src/ui/telemetry.ts` helpers (`telemetryInfo`, `telemetryWarn`, `telemetryError`)
- Stateful JSONL sink with rotation and oldest-first retention enforcement

### ✅ Retention Policy (1 GB)
- Floor: 700 MB (target after cleanup)
- Cap: 1 GB (triggers oldest-first prune)
- Persistent rotation state in `.state.json` for restart safety

### ✅ Runtime Configurability
- `DUET_TELEMETRY_MIN_MB` and `DUET_TELEMETRY_MAX_MB` env overrides
- Validation: both positive, MIN < MAX
- Invalid values disable file sink (console telemetry remains)
- Effective settings logged on startup

## UI/UX Observations

### Layout
- **Grid-based**: `#app` container with `gap: 16px`, `padding: 24px`
- **Panel styling**: Curved borders (14px), subtle shadows, warm off-white background
- **Design system**: IBM Plex Sans, neutral color palette, light mode only

### Panel Responsibilities
| Panel | Purpose |
|-------|---------|
| RunSelector | Run/host picker, loads list on mount |
| QuartetView | Family DB findings display |
| TrioView | Trio (Rust+Python) analysis results |
| AgentContextWindow | Read-only evidence context for agents |
| AgentChatPanel | Two-way agent interaction |
| DriftPanel | Config changes over time |
| TokenDashboard | Token consumption breakdown |
| JournalTimeline | Event audit trail |

### State Management
- Centralized in App class
- Active runId drives all panel updates
- Lazy-loads findings/artifacts/drift on run selection
- Graceful degradation on API failures

## API Contract

### Run Object
```typescript
interface Run {
  run_id: string;
  host_path: string;
  start_time: string;
  end_time: string|null;
  status: 'pending'|'running'|'completed'|'failed';
  error_code: string|null;
}
```

### Evidence / Artifact Flow
- Findings = Evidence records per run/layer
- Artifacts = Config snapshots, logs, diagnostic output
- Drift = Before/after comparison per host

## Testing Status
- **Config tests** ✅: DB path resolution, DUET_DB_PATH override, cascade validation
- **Telemetry tests** ✅: Storage rotation, oldest-first prune, state continuity
- **Build** ✅: Vite production bundle
- **Database tests** ⚠️: Fail due to local Node/native-module version mismatch (not code-related)

## Integration Points

### With `ai-vision` Project
- Path: `/home/spoq/ai-vision`
- Could import Duet UI as component library
- Duet's telemetry module (`src/ui/telemetry.ts`) emits structured events suitable for LLM ingestion

### With Trio/Quartet
- Duet UI polls `/api/runs` → populated by Trio host runner + Quartet DB
- Journal entries link back to runs for audit trail continuity

## Next Steps for Discussion

1. **Agent Integration**: How should AgentContextWindow feed prompts vs. telemetry logs?
2. **Real-time Updates**: WebSocket vs. polling for run status?
3. **Styling**: Adapt to `ai-vision` brand/theme?
4. **Export/Report**: Add PDF/markdown export from Journal or panels?
5. **Performance**: Panel virtualization if run count grows >1000?

## Files Reviewed
- `Diagnostic_Duet/vite.config.ts` - Dev server + telemetry sink init
- `Diagnostic_Duet/src/ui/app.ts` - Main UI orchestrator
- `Diagnostic_Duet/src/ui/panels/*.ts` (8 components)
- `Diagnostic_Duet/src/ui/telemetry.ts` - Structured telemetry helpers
- `Diagnostic_Duet/src/telemetry/storageWatch.ts` - Stateful retention watcher
- `Diagnostic_Duet/README.md` - Full telemetry/API documentation
