# US-039 / RF-021: Screenshot Retention Cleanup, Scavenger, And Evidence Audit Storyline

## Forge Directive

Use the Forge build loop for this story. Read `FORGE.md`, `AGENTS.md`, `prd.json`, `progress.txt`, Forge memory state, and the linked screenshot policy artifacts before writing code.

## Story

As the ai-vision workflow platform, I need screenshot files that are not durable evidence to be cleaned up predictably, and I need durable evidence screenshots to have a queryable audit trail before they can be reviewed, retained, exported, or deleted.

## Problem

`US-036` standardized screenshot payloads, `US-037` removed screenshot base64 from durable direct workflow JSON, and `US-038` added capture-time policy gates. The remaining risk is retention and audit after screenshot files exist.

Rolling/debug files can survive crashes, partial cleanup failures can create orphan files, and path-only evidence records are too brittle for compliance. Evidence deletion also needs intent/action integrity: the system must not claim a screenshot was deleted until the file deletion has been verified.

## Scope

Implement retention cleanup and evidence audit.

The story owns:

1. delete rolling/debug screenshots on successful wrap-up unless debug retention is explicitly enabled;
2. apply `ttl_24h` cleanup for failed/debug rolling artifacts;
3. add a bounded startup scavenger that does not block browser/session availability;
4. add a targeted wrap-up scavenger for the current session/run;
5. add durable failed-deletion retry/dead-letter state;
6. add a SQLite evidence audit table for who/what/when/why records;
7. add evidence audit states: `reviewed`, `retained`, `pending_deletion`, `deleted`, `delete_failed`, `rejected`, and `exported`;
8. generate stable evidence ids and capture-time content hashes for evidence screenshots;
9. use session end time, then capture timestamp, then filesystem `mtime` fallback for TTL decisions;
10. add WebSocket invalidation when evidence deletion is verified;
11. aggregate cleanup telemetry without screenshot bytes.

## Out Of Scope

Do not implement these in this story:

1. screenshot capture gates, redaction, or structured blocked responses from `US-038`;
2. durable base64 sanitization from `US-037`;
3. screenshot payload contract changes from `US-036`;
4. encryption-at-rest implementation;
5. historical migration of old screenshot artifacts beyond bounded scavenger classification/cleanup;
6. agentic/orchestrator output guard rail unless `mode: agentic` remains in production screenshot use.

## Critical Edge Rules

1. Step-scoped files are transient and must not be used as manual-review evidence.
2. Cleanup failures must be durable and retryable, not swallowed.
3. Startup cleanup must be bounded and resumable.
4. Final `deleted` audit state is written only after `fs.unlink` is verified.
5. Evidence audit must not rely on screenshot path alone; store evidence id and capture-time content hash.
6. Telemetry must be aggregated by cleanup batch and must never include screenshot bytes.

## References

- `docs/debriefs/2026-05-02-screenshot-retention-cleanup-evidence-audit-scratch-pad.md`
- `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design.md`
- `docs/artifacts/2026-05-01-us036-rf018-screenshot-payload-contract-storyline.md`
- `docs/artifacts/2026-05-02-us037-rf019-screenshot-persistence-sanitization-storyline.md`
- `docs/artifacts/2026-05-02-us038-rf020-screenshot-capture-policy-gate-storyline.md`

## Exit

Exit only when rolling/debug screenshots have cleanup paths, cleanup failures are durable/retryable, evidence screenshots have stable identities and capture-time hashes, manual evidence deletion is auditable and verified, and tests prove cleanup/audit behavior without leaking screenshot bytes.
