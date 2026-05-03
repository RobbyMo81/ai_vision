# Screenshot Security Policy Design — Implementation Handoff

Story: `US-035`
Tracker Row: `RF-017`
Source Storyline: `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design-storyline.md`
Source Story Card: `docs/artifacts/2026-05-01-us035-rf017-screenshot-security-policy-design-forge-story.yaml`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the storyline, YAML story card, definition of done, scratch pad, screenshot architecture debrief, screenshot findings investigation, `AGENTS.md`, `FORGE.md`, `prd.json`, tracker, progress, and Forge history before changing files.
2. Keep this story design-only. Do not implement runtime screenshot code.
3. Produce one authoritative design artifact under `docs/artifacts/`.
4. Update PRD, tracker, progress, and Forge history only after the design is complete.
5. Preserve `docs/debriefs/` as supporting investigation material, not the governed final deliverable.

## Task

Create the screenshot security policy design for ai-vision.

The design must answer:

- What screenshot classes exist?
- Which screenshot classes are live-only, durable, TTL-bound, manually retained, or blocked?
- What is the formal definition of an evidence screenshot?
- When must screenshot capture be blocked during `pii_wait` or sensitive-target steps?
- Should `GET /api/screenshot` require active client/session binding?
- Should MCP screenshot capture be gated and audited?
- Should workflow result JSON or wrap-up artifacts persist screenshot base64?
- Should durable evidence screenshots be encrypted at rest?
- How should old result JSON with screenshot base64 be handled?
- Which implementation stories should follow, and what does each own?

## Required Design Surfaces

The final design artifact must include:

1. Current architecture summary.
2. Screenshot class taxonomy.
3. Sensitivity model.
4. Evidence screenshot definition.
5. Capture policy by branch.
6. Persistence policy by destination.
7. Retention and cleanup policy.
8. API/MCP access and audit policy.
9. Encryption-at-rest decision.
10. Legacy data policy.
11. Implementation story split and sequencing.
12. Acceptance matrix mapping branches to policy decisions.

## Required Validation

- `jq empty prd.json` passes.
- The final design artifact covers every branch listed in the YAML story card.
- The final design artifact includes an implementation story split.
- The closing Summary of Work records typecheck/test status or explicitly says they were not run because this story is design-only.

## Non-Goals

- Do not add `ScreenshotPayload` code in this story.
- Do not change UI rendering in this story.
- Do not change persistence or wrap-up behavior in this story.
- Do not delete existing screenshot files.
- Do not migrate historical result JSON.

