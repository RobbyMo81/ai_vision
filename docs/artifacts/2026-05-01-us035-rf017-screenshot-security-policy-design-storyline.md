# Screenshot Security Policy Design

Story: `US-035`
Tracker Row: `RF-017`
Date: `2026-05-01`

## Problem

Screenshots currently cross live UI, MCP, workflow, orchestrator, browser-use, filesystem, SQLite, and wrap-up boundaries without a screenshot-specific security policy.

The system already protects typed sensitive values through HITL secure input and prompt redaction, but screenshot pixels can still contain DOB, SSN, addresses, credentials, payment forms, account data, private dashboards, or HITL target fields. Those pixels can then move through live base64 payloads, durable image files, workflow result JSON, wrap-up artifacts, and session history.

The repo needs a design-first policy story before runtime changes so implementation stories do not independently invent incompatible screenshot classes, retention rules, or sensitive-phase gates.

## Mission

Design the screenshot security policy layer for ai-vision.

The design must define how every screenshot-producing branch is classified, transported, persisted, blocked, or deleted, with particular attention to sensitive workflow phases and durable storage.

## Scope

This story is design-only.

It must define:

- screenshot classes such as `live_frame`, `debug_frame`, `evidence`, and `sensitive_blocked`
- sensitivity states and how they relate to `pii_wait`, sensitive-target steps, and private account pages
- retention modes for live, debug, rolling, and evidence screenshots
- durable persistence rules for filesystem images, `workflow_runs.result_json`, wrap-up artifacts, and `session_screenshots`
- whether evidence screenshots require encryption at rest
- whether `GET /api/screenshot` should use active client/session binding
- how screenshot capture should be audited through telemetry
- migration policy for historical result JSON containing base64 screenshots
- implementation story split for payload contract, persistence sanitization, sensitive gates, and cleanup

It must not:

- implement screenshot runtime code
- add migrations
- delete existing screenshots
- change workflow behavior
- weaken current HITL or PII controls

## Branches To Cover

- live UI websocket screenshots
- `GET /api/screenshot`
- browser-use action screenshots
- workflow `screenshot` steps
- workflow wrap-up and SQLite persistence
- `session_screenshots`
- rolling screenshots
- MCP `browser_screenshot`
- orchestrator screenshot tool outputs
- Python bridge screenshot endpoints

## Source Evidence

- `docs/debriefs/2026-04-26-screenshot-architecture-shape-layers-modules.md`
- `docs/debriefs/2026-05-01-screenshot-architecture-findings-investigation.md`
- `docs/debriefs/2026-05-01-screenshot-workflow-investigation-scratch-pad.md`
- `src/session/manager.ts`
- `src/ui/server.ts`
- `src/workflow/engine.ts`
- `src/workflow/types.ts`
- `src/workflow/wrap-up.ts`
- `src/db/repository.ts`
- `src/orchestrator/loop.ts`
- `src/mcp/server.ts`
- `src/engines/python-bridge.ts`
- `src/engines/browser-use/server/main.py`

## Outcome Required

At the end of this story, the repo must contain one authoritative design artifact that future implementation stories can follow without rediscovering screenshot flow, storage policy, or sensitive-data handling.

The design must leave no ambiguity about which screenshots may be durable, which are live-only, when capture must be blocked, what metadata every screenshot boundary needs, and how legacy base64 should be treated.

