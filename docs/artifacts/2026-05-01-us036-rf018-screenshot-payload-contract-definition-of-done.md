# Screenshot Payload Contract — Definition Of Done

Story: `US-036`
Tracker Row: `RF-018`

Done means:

1. `ScreenshotPayload` exists and includes source, class, MIME type, sensitivity, retention, and base64 persistence metadata.
2. Live UI screenshot events include the payload container while preserving legacy `screenshotBase64`.
3. Browser UI screenshot rendering is MIME-aware.
4. Browser-use action screenshots render live when present.
5. Browser-use action event normalization infers PNG/JPEG MIME type when base64 signatures are recognizable.
6. Orchestrator screenshot tool outputs are JSON payload containers instead of raw base64 strings.
7. Focused regression tests cover the changed behavior.
8. Persistence sanitization, sensitive gates, and cleanup remain deferred to follow-on stories.
9. `jq empty prd.json`, typecheck, and focused tests pass or any inability to run is recorded.

