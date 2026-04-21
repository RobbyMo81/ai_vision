# User Preferences

Last updated: 2026-04-20

## Workflow Defaults

- **Default engine**: `browser-use` (Python bridge via FastAPI)
- **Headless mode**: `true` — run headless unless a CAPTCHA or visual debugging is required
- **Screenshot on step completion**: `true`
- **Max agent steps per workflow step**: `25`
- **Human-in-the-loop approval**: required before any destructive or irreversible action (post, submit form, delete)

## Output & Logging

- **Log level**: `info` — suppress debug-level noise in production; enable `debug` when investigating failures
- **Session summary**: always print a brief summary after workflow completion
- **Screenshot storage**: `./sessions/<session-id>/screenshots/`
- **Telemetry**: enabled; events written to `ai-vision.db`

## Content & Posting

- **Default post tone**: informative and neutral
- **Max post length**: 500 words unless the workflow explicitly specifies otherwise
- **Attribution**: include "Generated with AI assistance" footer on AI-authored posts when platform allows
- **Subreddits approved for automated posting**: `r/test` only (all others require explicit human approval)

## Safety & Rate Limits

- **Inter-action delay**: minimum 1 500 ms between successive clicks/form submissions on rate-limited platforms
- **Retry policy**: up to 3 retries on transient network errors; no retry on 4xx client errors
- **Banned action list**: voting, following/friending accounts, sending direct messages — these require explicit user consent per run

## Notification Preferences

- **On workflow success**: log to console only
- **On workflow failure**: log to console + write to `./sessions/<session-id>/error.log`
- **Webhook callbacks**: disabled by default; enable via `ENABLE_WEBHOOK_CALLBACKS=true`
