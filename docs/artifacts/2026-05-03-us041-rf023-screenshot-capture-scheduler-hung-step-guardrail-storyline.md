# US-041 / RF-023: Screenshot Capture Scheduler And Hung-Step Guardrail Storyline

## Forge Directive

Use the Forge build loop for this story. Read `FORGE.md`, `AGENTS.md`, `prd.json`, `progress.txt`, Forge memory state, and the linked screenshot timing investigation documents before writing code.

## Story

As the ai-vision workflow platform, I need screenshot capture requests to be coordinated so live UI, MCP, workflow evidence, rolling debug, and browser-use action screenshots do not create avoidable capture contention, misleading telemetry, or unbounded debug-frame growth during stalled workflow steps.

## Problem

The Reddit duplicate-check incident showed that screenshot loops continued while the workflow was stuck. Telemetry showed hundreds of screenshot capture decisions across UI live frames and rolling debug frames while the workflow made no progress.

The current screenshot architecture has multiple capture timings:

1. HITL UI live push loop around every `1200ms`;
2. rolling debug timer around every `5000ms`;
3. on-demand `/api/screenshot`;
4. MCP screenshot requests;
5. explicit workflow evidence screenshot steps;
6. browser-use action screenshots.

These paths can overlap and compete for Playwright screenshot encoding. Some paths also perform synchronous filesystem writes/deletes. The result is I/O and CPU pressure during exactly the failure mode where the workflow is already stalled.

## Scope

Implement a shared screenshot capture scheduler and hung-step guardrail for the Node runtime screenshot paths.

The story owns:

1. request collapsing for duplicate UI live-frame captures while one capture is in flight;
2. priority ordering so explicit workflow evidence screenshots are not starved by UI or rolling captures;
3. scheduler integration for UI live screenshots, `/api/screenshot`, MCP screenshots, rolling debug screenshots, and workflow evidence screenshots;
4. preservation of the existing screenshot policy gate from `US-038`;
5. preservation of screenshot payload and persistence behavior from `US-036` and `US-037`;
6. hung-step rolling debug throttle/pause behavior;
7. top-level `step_id` telemetry for screenshot allow/redact/block/scheduler events when a workflow step is known;
8. byte-free scheduler telemetry for queued, collapsed, executed, throttled, and skipped captures;
9. focused tests for priority, collapse, throttle, and telemetry.

## Required Behavior

1. Collapse duplicate UI live-frame requests if a UI capture is already in flight.
2. Preserve a useful response for collapsed UI requests:
   - either share the in-flight result, or return a structured collapsed/no-new-frame result that keeps UI stable.
3. Give explicit workflow evidence screenshots priority over UI live frames and rolling debug frames.
4. Route MCP screenshot requests through the same scheduler and existing policy decision path.
5. Route rolling debug captures through the scheduler.
6. Keep browser-use action screenshots as live action-event payloads; do not rewrite browser-use internals unless needed to avoid duplicate Node-side captures.
7. Preserve `pii_wait` blocking and sensitive-region redaction behavior.
8. Do not persist screenshot base64.
9. Emit byte-free telemetry for scheduler decisions.
10. Set top-level telemetry `stepId` where the active workflow step is known.

## Hung-Step Guardrail

Rolling debug capture must pause or sharply throttle when the same workflow step remains active beyond a bounded duration.

Suggested defaults:

| Setting | Default |
| --- | --- |
| Healthy rolling cadence | `5000ms` |
| Hung-step threshold | `30000ms` on the same workflow step without step transition |
| Throttled rolling cadence | no more than one debug frame per `60000ms`, or fully paused if simpler |

The guardrail must reset on workflow step advance.

## Priority Model

Use this priority order unless the implementation has a stronger local pattern:

1. `workflow` evidence screenshot
2. `mcp` screenshot
3. `ui` on-demand screenshot
4. `ui` live-frame push
5. `rolling` debug frame

Sensitive blocking and redaction policy still wins over priority. A high-priority request must not bypass `US-038`.

## Out Of Scope

Do not implement these in this story:

1. deterministic Reddit duplicate evidence from `US-040`;
2. post-task `120000ms` screenshot TTL cleanup from planned `US-042`;
3. new evidence audit schema changes from `US-039` unless a small telemetry field is required;
4. screenshot payload shape changes from `US-036`;
5. durable persistence sanitization changes from `US-037`;
6. broad browser-use Python bridge refactors;
7. encryption-at-rest or historical migration.

## Critical Edge Rules

1. The scheduler must not cause evidence screenshots to be dropped.
2. UI live-frame collapse must not break the HITL UI or leave it rendering corrupt image data.
3. Rolling debug throttle must not affect explicit workflow evidence screenshots.
4. Sensitive-phase blocks must return structured no-pixel responses as before.
5. Telemetry must never include screenshot bytes.
6. The scheduler must be testable without a real browser by mocking `page.screenshot()` or `SessionManager.captureScreenshot(...)` internals.

## References

- `docs/debriefs/2026-05-03-reddit-duplicate-check-stall-blast-radius.md`
- `docs/debriefs/2026-05-03-reddit-screenshot-recovery-implementation-story-plan.md`
- `docs/artifacts/2026-05-02-us038-rf020-screenshot-capture-policy-gate-storyline.md`
- `docs/artifacts/2026-05-02-us039-rf021-screenshot-retention-cleanup-scavenger-evidence-audit-storyline.md`
- `src/session/manager.ts`
- `src/session/screenshot-policy.ts`
- `src/ui/server.ts`
- `src/mcp/server.ts`
- `src/workflow/engine.ts`

## Exit

Exit only when screenshot capture requests are coordinated through a scheduler, duplicate UI live captures are collapsed, evidence screenshots are prioritized, rolling debug capture is paused or throttled during hung steps, telemetry accurately reflects scheduler decisions and top-level step ids, and focused tests plus typecheck pass.
