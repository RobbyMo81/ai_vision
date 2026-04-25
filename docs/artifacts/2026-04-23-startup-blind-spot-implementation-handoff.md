# Startup Blind-Spot Seam Closure Implementation Handoff

Story: `EN-008`
Tracker Row: `EN-008`
Source Story Card: `docs/artifacts/2026-04-23-startup-blind-spot-forge-story.yaml`
Source Audit: `docs/artifacts/telemetry-audit-2026-04-22.md`

## Forge System Instructions

Use the Forge system and the Forge build loop explicitly.

1. Read the story card and audit artifact before changing code.
2. Inspect the audited startup seams at workflow, MCP, webhook, and UI boundaries.
3. Implement the smallest coherent cleanup that removes the hidden cast or inference seam while preserving startup behavior.
4. Run the relevant tests and `pnpm exec tsc --noEmit`.
5. Write back progress, tracker evidence, and Forge memory context for the next agent.

Do not widen the scope into a general telemetry rewrite. This story is about making startup boundaries explicit and typed.

## Scope

Close the remaining audit blind spots identified in the startup path:

- workflow step substitution cast
- workflow schema expansion seam
- MCP server boundary cast
- webhook payload inference seam
- UI websocket import cast

## Required Outputs

The story is not complete until all of the following exist:

1. The audited startup seams have been replaced with explicit typed helpers or interfaces.
2. Startup behavior remains intact for workflow, MCP, webhook, and UI boot paths.
3. Validation evidence shows `pnpm exec tsc --noEmit` still passes.
4. Tracker and progress entries record the closure.

## Acceptance Criteria

- No audited startup seam remains as a hidden `as unknown as`, `as any`, or equivalent inference boundary on the startup path.
- Workflow startup continues to use the same execution behavior, but without the cast seam flagged by the audit.
- MCP tool registration remains functional, but the registration boundary is explicit instead of being hidden behind an untyped cast.
- Webhook payload validation and startup remain unchanged in behavior, but the exported shape is no longer a blind inference seam.
- UI startup continues to load the websocket integration without an `as any` import boundary.
- Compiler health is preserved.

## Definition of Done

Done means the startup audit blind spots are closed with explicit typed boundaries, the startup flow still initializes cleanly, and the repo has evidence in the tracker, progress log, and Forge artifacts for the next agent.

## Implementation Notes

- Keep the scope narrow and startup-focused.
- Preserve runtime semantics first; the target is the hidden seam, not the behavior.
- Prefer local typed adapters or exported interfaces over broad type-system reshaping.
- If one seam cannot be closed safely without a follow-on story, stop at the narrow blocker and document it.
