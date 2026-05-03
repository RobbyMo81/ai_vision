# US-039 / RF-021 Definition Of Done

## Done Means

`US-039 / RF-021` is done when non-evidence screenshot files are cleaned up according to retention policy, cleanup failures are durable and retryable, and retained evidence screenshots have stable identity plus verified who/what/when/why audit trails.

## Required Outcomes

1. Rolling/debug screenshots are deleted on successful wrap-up unless debug retention is enabled.
2. Failed/debug rolling artifacts are retained only until `ttl_24h` cleanup eligibility.
3. Startup scavenger processes bounded work units and does not block browser/session availability.
4. Wrap-up scavenger reconciles current-session files.
5. Cleanup failures create durable retry/dead-letter records.
6. Evidence screenshots receive stable evidence ids.
7. Evidence screenshots receive capture-time content hashes.
8. Evidence audit records actor, target, action, reason, timestamp, evidence id, path, and content hash with no screenshot bytes.
9. Evidence deletion records `pending_deletion` before unlink, `deleted` only after verified unlink, and `delete_failed` on failure.
10. TTL precedence uses session end time, then capture timestamp, then filesystem `mtime` fallback.
11. WebSocket invalidation is broadcast after verified evidence deletion.
12. Cleanup telemetry is aggregated by batch and contains no screenshot bytes.
13. Step-scoped screenshots remain transient and are not eligible for evidence audit/manual review.

## Required Tests

Focused tests must prove:

1. successful wrap-up deletes rolling/debug screenshots unless debug retention is enabled;
2. failed/debug runs retain rolling artifacts until TTL eligibility;
3. startup scavenger is bounded and resumable;
4. wrap-up scavenger reconciles current-session files;
5. failed deletion creates retry/dead-letter state;
6. evidence id and capture-time hash are stored;
7. evidence deletion state transition is `pending_deletion` -> verified unlink -> `deleted`;
8. failed unlink records `delete_failed`;
9. WebSocket invalidation fires after verified deletion;
10. cleanup telemetry is aggregated and byte-free;
11. audit rows contain no screenshot base64.

## Required Validation

The implementing agent must run and record:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand <focused test files>
```

Run full `pnpm test` if shared repository/session/wrap-up contracts are touched broadly.

## Governance Closeout

The implementing agent must update:

1. `prd.json`
2. `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`
3. `progress.txt`
4. `docs/history/forge_history.md`
5. `docs/history/history_index.md`
6. Forge memory story state

The final response must include Summary of Work, files touched, acceptance criteria, and final validation result.
