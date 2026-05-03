# US-041 / RF-023 Implementation Handoff

## Agent Prompt

You are implementing `US-041 / RF-023: Screenshot Capture Scheduler And Hung-Step Guardrail` in the ai-vision repository. Follow the Forge workflow exactly.

Before editing code:

1. read `FORGE.md`;
2. read `AGENTS.md`;
3. read `prd.json`;
4. read `progress.txt`;
5. query Forge memory for current story state and unread messages;
6. read the source artifacts listed below.

Source artifacts:

- `docs/debriefs/2026-05-03-reddit-duplicate-check-stall-blast-radius.md`
- `docs/debriefs/2026-05-03-reddit-screenshot-recovery-implementation-story-plan.md`
- `docs/artifacts/2026-05-02-us038-rf020-screenshot-capture-policy-gate-storyline.md`
- `docs/artifacts/2026-05-02-us039-rf021-screenshot-retention-cleanup-scavenger-evidence-audit-storyline.md`

## Build Target

Add a screenshot capture scheduler that coordinates Node runtime screenshot capture requests and prevents rolling debug screenshots from accumulating during a hung workflow step.

## Expected Code Areas

Inspect these first:

- `src/session/manager.ts`
- `src/session/screenshot-policy.ts`
- `src/session/types.ts`
- `src/ui/server.ts`
- `src/mcp/server.ts`
- `src/workflow/engine.ts`
- `src/telemetry/manager.ts`
- `src/session/manager.test.ts`
- `src/ui/server.test.ts`
- `src/mcp/server.test.ts`
- `src/workflow/engine.test.ts`

Prefer a small, testable scheduler abstraction owned by the session layer. Keep the existing screenshot policy decision helper as the authority for allow/redact/block/step-scoped/evidence behavior.

## Required Behavior

1. Collapse duplicate UI live-frame captures while one UI live capture is already in flight.
2. Preserve stable UI behavior for collapsed live-frame requests.
3. Prioritize explicit workflow evidence screenshots over UI live frames and rolling debug captures.
4. Route MCP screenshot requests through the same scheduler while preserving `/api/screenshot` and MCP access policy.
5. Route rolling debug capture through the scheduler.
6. Add a hung-step guardrail for rolling debug capture:
   - detect same step active longer than a bounded threshold;
   - pause or sharply throttle rolling debug captures;
   - reset when the workflow advances to a new step.
7. Preserve `pii_wait` and sensitive-target blocking/redaction from US-038.
8. Emit byte-free telemetry for scheduler decisions.
9. Set top-level telemetry `stepId` on screenshot events when known.

## Suggested Defaults

```text
healthy rolling cadence: 5000ms
hung-step threshold:     30000ms
throttled cadence:       at most one rolling debug frame per 60000ms
```

It is acceptable to fully pause rolling debug capture after the threshold if this is simpler and telemetry records the pause.

## Priority Order

Use this priority order unless the existing code shape strongly suggests a cleaner equivalent:

1. workflow evidence screenshot
2. MCP screenshot
3. UI on-demand screenshot
4. UI live-frame push
5. rolling debug frame

Sensitive blocking/redaction still wins over priority.

## Explicit Non-Goals

Do not implement:

- deterministic Reddit duplicate evidence from `US-040`;
- post-task 120s screenshot TTL cleanup from `US-042`;
- screenshot payload contract changes;
- durable base64 sanitization changes;
- broad evidence audit schema changes;
- broad browser-use Python bridge refactors;
- encryption-at-rest;
- historical migration.

## Testing Requirements

Add focused tests proving:

1. concurrent UI live-frame requests do not launch duplicate `page.screenshot()` calls;
2. collapsed UI requests keep a stable result or structured no-new-frame result;
3. workflow evidence capture is not starved by UI or rolling captures;
4. MCP capture goes through scheduler and policy;
5. rolling debug capture pauses/throttles after the hung-step threshold;
6. step advance resets the hung-step guardrail;
7. sensitive-phase behavior still blocks or redacts as before;
8. screenshot telemetry includes top-level `stepId` when the active step is known;
9. scheduler telemetry contains no screenshot bytes.

Run:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand src/session/manager.test.ts src/ui/server.test.ts src/mcp/server.test.ts src/workflow/engine.test.ts
```

Run full `pnpm test` if shared session/workflow contracts are touched broadly.

## Closeout

When implementation is complete:

1. mark `US-041` complete in `prd.json`;
2. mark `RF-023` complete in `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`;
3. update this story card status to completed;
4. update architecture atlas if screenshot runtime flow changes materially;
5. append a full history entry to `docs/history/forge_history.md`;
6. append a library-card row to `docs/history/history_index.md`;
7. update `progress.txt` with Summary of Work, files touched, acceptance criteria, and validation results;
8. write Forge memory story state and useful discoveries.
