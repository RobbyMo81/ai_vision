# Confirm Final Step Trace And Preflight Requirements

Date: 2026-04-25
Type: Investigation instrumentation artifact (trace-only)
Scope: Local UI/HITL server context attribution for final confirmation calls

## Investigation Question

Was there any other client context attached to localhost:3011 when `confirmed: true` was posted?

## Current Gap (Pre-fix)

The runtime does not strongly bind a final confirmation request to one active run context. Specifically:

- no explicit pre-flight check for existing UI servers with attached clients
- no session-bound confirmation token
- no request-to-run binding enforcement on `/api/confirm-final-step`
- no caller identity capture for final confirmation requests

## Instrumentation Pass (Trace-only)

This pass intentionally does not enforce or block requests. It only adds attribution fields.

### `/api/confirm-final-step`

Record telemetry on request receipt and completion with:

- request `confirmed`
- request `requestId` (if supplied)
- request `sessionId` (if supplied)
- active run session id from `workflowEngine.currentState.id`
- computed `requestRunBinding` boolean (only when request session id exists)
- current `phase`
- current `hitlAction`
- current `currentStep`
- active websocket connection count
- caller metadata:
  - remote address and port
  - `x-forwarded-for`
  - `user-agent`
  - `origin`
  - `referer`
  - `host`
  - request method/path

### WebSocket client context

Record connect/disconnect telemetry with:

- assigned per-connection `wsClientId`
- websocket connection count at event time

## Why This Reduces Uncertainty

It narrows ambiguous caller paths (active tab vs stale tab vs external caller) into attributable event traces that can be correlated with the active run context.

## Deliberate Non-goals In This Pass

- no session token enforcement
- no request rejection based on caller metadata
- no run-binding hard enforcement
- no new storyline or fix rollout

## Next Step After Trace Review

Use observed telemetry evidence to decide whether to implement a strict binding model:

- per-run confirmation token
- required request session id
- caller allowlist policy for localhost/UI process paths
- pre-flight check for stale/parallel UI server contexts
