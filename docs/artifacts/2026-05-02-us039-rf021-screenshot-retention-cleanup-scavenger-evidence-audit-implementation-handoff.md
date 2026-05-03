# US-039 / RF-021 Implementation Handoff

## Agent Prompt

You are implementing `US-039 / RF-021: Screenshot Retention Cleanup, Scavenger, And Evidence Audit` in the ai-vision repository. Follow the Forge workflow exactly.

Before editing code:

1. read `FORGE.md`;
2. read `AGENTS.md`;
3. read `prd.json`;
4. read `progress.txt`;
5. query Forge memory for current story state and unread messages;
6. read the source artifacts listed below.

Source artifacts:

- `docs/debriefs/2026-05-02-screenshot-retention-cleanup-evidence-audit-scratch-pad.md`
- `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design.md`
- `docs/artifacts/2026-05-02-us038-rf020-screenshot-capture-policy-gate-storyline.md`

## Build Target

Implement retention cleanup and evidence audit after screenshots exist. Do not change capture-time policy unless required to preserve existing US-038 behavior.

## Expected Code Areas

Inspect these first:

- `src/session/manager.ts`
- `src/session/types.ts`
- `src/workflow/engine.ts`
- `src/workflow/wrap-up.ts`
- `src/db/repository.ts`
- `src/db/migrations/`
- `src/ui/server.ts`
- `src/telemetry/manager.ts`
- existing tests around session manager, wrap-up, repository, and UI server

## Required Behavior

1. Delete rolling/debug screenshot files on successful wrap-up unless debug retention is explicitly enabled.
2. Apply `ttl_24h` cleanup for failed/debug rolling artifacts.
3. Add a bounded startup scavenger that does not block browser/session availability.
4. Add a targeted wrap-up scavenger for the current session/run.
5. Persist cleanup failures into a retry/dead-letter table or equivalent durable queue.
6. Add a SQLite evidence audit table.
7. Evidence audit actions must support `reviewed`, `retained`, `pending_deletion`, `deleted`, `delete_failed`, `rejected`, and `exported`.
8. Generate stable evidence ids for evidence screenshots.
9. Compute capture-time content hashes for evidence screenshots.
10. For TTL decisions use session end time first, capture timestamp second, filesystem `mtime` only as orphan fallback.
11. For evidence deletion, write `pending_deletion`, attempt unlink, verify the file is gone, then write `deleted`; write `delete_failed` if unlink/verification fails.
12. Broadcast a WebSocket invalidation event after verified evidence deletion.
13. Aggregate cleanup telemetry by batch with counts/categories and no screenshot bytes.
14. Keep step-scoped screenshots out of evidence audit/manual review.

## Explicit Non-Goals

Do not implement:

- screenshot capture gates or redaction from `US-038`;
- durable base64 sanitization from `US-037`;
- screenshot payload contract changes from `US-036`;
- encryption-at-rest;
- broad historical migration;
- agentic/orchestrator output guard rail unless `mode: agentic` remains in production screenshot use.

## Testing Requirements

Add focused tests proving:

1. successful wrap-up deletes rolling/debug screenshots unless debug retention is enabled;
2. failed/debug runs keep rolling artifacts until TTL eligibility;
3. startup scavenger is bounded and resumable;
4. wrap-up scavenger reconciles current-session files;
5. failed file deletion creates durable retry/dead-letter state;
6. evidence ids and capture-time content hashes are stored;
7. evidence deletion moves through `pending_deletion` to `deleted` only after verified unlink;
8. failed unlink records `delete_failed`;
9. WebSocket invalidation fires after verified deletion;
10. cleanup telemetry is aggregated and byte-free;
11. audit rows contain no screenshot base64.

Run:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand <focused test files>
```

Run full `pnpm test` if shared repository/session/wrap-up contracts are touched broadly.

## Closeout

When implementation is complete:

1. mark `US-039` complete in `prd.json`;
2. mark `RF-021` complete in `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`;
3. append a full history entry to `docs/history/forge_history.md`;
4. append a library-card row to `docs/history/history_index.md`;
5. update `progress.txt` with Summary of Work, files touched, acceptance criteria, and validation results;
6. write Forge memory story state and useful discoveries.
