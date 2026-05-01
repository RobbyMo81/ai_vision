# US-025 Return-Control Production Test

Date: `2026-04-27`

Story: `US-025 / RF-007`

Purpose: validate the implemented return-control pre-flight binding gates in a live HITL workflow run.

## Test Workflow

Temporary workflow file:

```text
/tmp/us025-return-control-production-test.yaml
```

Workflow shape:

- direct YAML workflow
- one `human_takeover` step
- expected public state: `phase=awaiting_human`, `hitlAction=return_control`
- expected resume endpoint: `POST /api/return-control`

This kept the test on the real CLI, UI server, direct workflow engine, HITL coordinator, HTTP endpoint, websocket attribution, telemetry manager, SQLite persistence, and wrap-up path without adding unrelated Reddit/browser-use side effects.

## Runs

### Run 1

- UI port: `3013`
- Session: `10afad55-b32b-4f6e-998d-58dd21701e87`
- Initial state: `awaiting_human:return_control`
- Result: workflow completed successfully
- Memory story: `/home/spoq/.ai-vision/memory/stories/us025_return_control_production_test-10afad55-b32b-4f6e-998d-58dd21701e87.md`

Evidence:

- mismatched session request emitted `ui.hitl.return_control.rejected` with `gate=session_binding_gate`
- stale client request emitted `ui.hitl.return_control.rejected` with `gate=websocket_presence_gate`
- active client websocket connected as `page-us025-active`
- active request emitted `ui.hitl.return_control.completed`
- workflow emitted `workflow.phase.changed` to `complete`
- workflow emitted `workflow.run.completed` with `success=true`

### Run 2

- UI port: `3014`
- Session: `fccf648d-6497-4fcf-b718-ffe48156232f`
- Initial state: `awaiting_human:return_control`
- Result: workflow completed successfully
- Memory story: `/home/spoq/.ai-vision/memory/stories/us025_return_control_production_test-fccf648d-6497-4fcf-b718-ffe48156232f.md`

HTTP response evidence:

| Scenario | Request | Expected | Observed |
|---|---|---:|---:|
| Session mismatch | `sessionId=wrong-session`, `clientId=page-us025-mismatch-2` | `400` | `400` |
| Stale client | valid session, `clientId=page-us025-stale-2`, no websocket | `403` | `403` |
| Active client | valid session, `clientId=page-us025-active-2`, live websocket | `200` | `200` |

Response body evidence:

```json
{"error":"Session ID mismatch"}
{"error":"No active UI session for this client"}
{"ok":true}
```

Telemetry evidence:

- `ui.hitl.return_control.received` emitted for all three request paths
- `ui.hitl.return_control.rejected` emitted for mismatch and stale-client paths
- `ui.hitl.return_control.completed` emitted for active-client success
- `ui.ws.connected` recorded the active page websocket:
  - `pageClientId=page-us025-active-2`
  - `matchingWsClientIds=["ws-1777264419999-1"]`
  - `matchingWsClientCount=1`
- active request recorded:
  - `requestRunBinding=true`
  - `requestSessionId=fccf648d-6497-4fcf-b718-ffe48156232f`
  - `activeSessionId=fccf648d-6497-4fcf-b718-ffe48156232f`
  - `resolvedClientId=page-us025-active-2`
  - `currentPhase=awaiting_human`
  - `currentHitlAction=return_control`
  - `currentStep=us025_manual_resume`
- completion telemetry recorded:
  - `workflow.phase.changed` with `phase=running`
  - `workflow.phase.changed` with `phase=complete`
  - `workflow.run.completed` with `success=true`
  - `workflow.wrapup.completed` with `success=true`

## Requirement Matrix

| Requirement | Result | Evidence |
|---|---:|---|
| Run a workflow that enters `awaiting_human:return_control` | Pass | `/api/status` returned `phase=awaiting_human`, `hitlAction=return_control` for both runs |
| Resume from active UI/client and confirm success | Pass | active websocket `page-us025-active-2`, HTTP `200`, `ui.hitl.return_control.completed`, workflow complete |
| Attempt mismatched-session resume and confirm rejection | Pass | HTTP `400`, `session_binding_gate`, response `Session ID mismatch` |
| Attempt stale-client resume and confirm rejection | Pass | HTTP `403`, `websocket_presence_gate`, response `No active UI session for this client` |
| Confirm `received`, `rejected`, and `completed` telemetry | Pass | SQLite `telemetry_events` contains all three event names for the production sessions |
| Confirm workflow completes normally after valid resume | Pass | CLI exited success and memory stories were written for both runs |

## Notes

- The active UI tab was represented by a live websocket client using the same page-client identity that the browser UI uses.
- The test intentionally avoided Reddit/browser-use posting so the validation isolated the HITL return-control perimeter.
- The run surfaced an existing Node 24 deprecation warning from `url.parse()` in the UI server path:

  ```text
  [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead.
  ```

  This is a runtime API deprecation warning, not a V8 heap-lockout signal. It did not block the production validation and should be tracked separately as HTTP/server hardening if it becomes a target.

## Conclusion

`US-025 / RF-007` passed the minimum full HITL production test.

The return-control endpoint now rejects mismatched-session and stale-client resume attempts, accepts the active-client resume path, emits the required telemetry, and allows the workflow to complete normally after valid resume.
