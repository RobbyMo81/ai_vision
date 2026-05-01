# Live Confirmation Attribution Test

Date: 2026-04-26
Workflow: `post_to_reddit`
Session: `a972fd5c-187e-4f2c-b53d-00d0582c43bd`
UI port: `3012`
Target: `r/test`

## Result

The workflow completed and published a test post:

- Title: `US-023-trace-live-20260426`
- Body actually submitted: `Trace-only`
- URL: `https://www.reddit.com/r/test/comments/1svzv25/us023tracelive20260426/`
- Workflow result: success
- Stored `hitlOutcomeConfirmed`: `true`

## Attribution Finding

The final confirmation was submitted before the supervisor sent any manual confirmation request.

Telemetry identified the confirming caller as an active Firefox UI page:

- Event: `ui.hitl.confirm_final_step.received`
- Timestamp: `2026-04-26T06:34:27.018Z`
- `requestSessionId`: `a972fd5c-187e-4f2c-b53d-00d0582c43bd`
- `activeSessionId`: `a972fd5c-187e-4f2c-b53d-00d0582c43bd`
- `requestRunBinding`: `true`
- `requestClientId`: `page-mofe314c-qkau4srt`
- `headerClientId`: `page-mofe314c-qkau4srt`
- `resolvedClientId`: `page-mofe314c-qkau4srt`
- `matchingWsClientIds`: `["ws-1777185034865-1"]`
- `matchingWsClientCount`: `1`
- `wsConnectionCount`: `2`
- `userAgent`: `Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:149.0) Gecko/20100101 Firefox/149.0`
- `origin`: `http://localhost:3012`
- `referer`: `http://localhost:3012/`
- `remoteAddress`: `::ffff:127.0.0.1`

## Interpretation

This was not a non-UI caller.

This was not the controlled supervisor websocket client (`page-live-active-3012`). That client connected as:

- `wsClientId`: `ws-1777185051379-2`
- `pageClientId`: `page-live-active-3012`

The confirming request came from a separate active Firefox UI page with a connected websocket:

- `pageClientId`: `page-mofe314c-qkau4srt`
- `wsClientId`: `ws-1777185034865-1`

The trace fields are now sufficient to distinguish active UI, stale-like UI, and non-UI callers during a real workflow run.

## Additional Observation

The draft review gate also resumed without supervisor action:

- `review_reddit_draft` entered `awaiting_human` at `2026-04-26T06:33:01.251Z`
- it returned to `running` at `2026-04-26T06:33:07.413Z`

That path should be investigated separately through equivalent caller attribution on `/api/return-control`.

## Environment Note

The first live attempt failed before workflow execution because the Playwright Chromium cache was missing. The required browser cache was installed with:

```bash
pnpm exec playwright-core install chromium
```

The local `pnpm exec playwright install chromium` path failed because the installed `playwright` CLI crashed under Node 24 before download. `playwright-core` installer succeeded.
