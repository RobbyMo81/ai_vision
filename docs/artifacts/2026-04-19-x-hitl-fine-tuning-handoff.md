# ai-vision X/Twitter HITL Fine-Tuning Handoff

Date: 2026-04-19
Prepared by: Codex
Target team: follow-on engineering / fine-tuning team

## Scope

This handoff covers the recent live HITL testing and stabilization work for the `post_to_x` workflow in `ai-vision`, plus the remaining fine-tuning backlog that should be handled by a separate team.

The application is now materially more reliable than at the start of testing:

- recurring-authenticated login handling works
- the agent now performs the final irreversible action itself
- HITL verifies the visible final state instead of clicking the last button for the agent
- negative final review creates a structured SIC/self-heal path
- the previous `browser-use` second-step crash was fixed

The remaining work is mostly refinement, not foundational architecture.

## Executive Summary

### Current state

The application is functionally capable of running the X/Twitter workflow end to end with live HITL.

The latest rerun proved:

- the login gate was correctly treated as verification-first, not hard login
- the draft step succeeded
- the publish step succeeded technically and clicked `Post`
- the workflow reached the final HITL confirmation gate as designed

The final test outcome was still a workflow failure, but it was an external platform outcome:

- X/Twitter rejected the post with `Whoops! You already said that.`
- no new post was created because identical content had already been posted previously on the same account

That means the application-side blocker is no longer the primary issue. The next team should focus on polish, prechecks, resilience, and operator ergonomics.

## What Was Fixed During This Test Cycle

### 1. Recurring authentication flow

The login step was refactored from a hard manual-login assumption into a generic schema-driven verification pattern:

- `authVerification` now models recurring authenticated-state checks as a reusable workflow contract
- recurring workflows can skip unnecessary login pauses when the portal is already signed in
- if authenticated state is not obvious, HITL is asked to verify instead of being told to log in blindly

### 2. Final-step ownership

The workflow contract changed so the agent performs the real final action:

- the agent clicks `Post`
- HITL reviews the visible result afterward
- HITL uses `Confirm Final Step` or `Mark Final Step Failed`

This removed the previous false-positive pattern where the workflow could appear successful even when the human had not actually allowed the last step to happen.

### 3. SIC/self-heal on final rejection

When HITL rejects the final result:

- the rejection reason is captured explicitly
- the workflow fails with that reason
- the rejection is promoted into a SIC/self-heal input

This is the correct control loop for real-world operator-guided recovery.

### 4. `browser-use` sequential task lifecycle bug

The original live X test exposed a serious application bug:

- `draft_post` succeeded
- `publish_post` failed because the second `browser-use` task lost healthy session state

Two concrete failure modes were discovered:

1. stale CDP/session state between sequential `browser-use` tasks
2. `browser-use` reset its internal event bus after the first task, leaving the second task without required handlers

The bridge was patched in:

- [src/engines/browser-use/server/main.py](/home/spoq/ai-vision/src/engines/browser-use/server/main.py)

The bridge now:

- validates session health before each task/page access
- recreates a fresh `BrowserSession` object when the library has reset itself
- restores focus to an existing page when possible
- retries once for recognized CDP/session failure signatures

This fix is what allowed the most recent rerun to cross `publish_post` successfully.

## Latest Live Test Outcome

### Workflow

- workflow id: `post_to_x`
- live session: `3a289f3f-be2b-4d63-bc6f-c2be95a0f917`

### Observed sequence

1. `open_x` succeeded
2. `x_login` was skipped via authenticated-state verification
3. `draft_post` succeeded
4. `publish_post` ran in the shared session
5. the agent clicked `Post`
6. X/Twitter rejected the post as duplicate content
7. workflow reached `confirm_post_visible` final HITL confirmation as designed

### Important conclusion

The latest failure was not caused by the application runtime. It was caused by platform behavior:

- X returned `Whoops! You already said that.`
- identical content already existed on the same account
- no new post was created

This is the correct kind of failure for the workflow to surface.

## Fine-Tuning Backlog For The Next Team

### Priority 1: Duplicate-post preflight

Add a dedicated social-post duplicate-risk precheck before `publish_post`.

Goal:

- detect when the exact post text or near-identical text already exists on the account
- prevent a doomed final publish attempt

Suggested approaches:

- query recent timeline/profile context before publish
- treat exact-match post text as a guarded risk
- route to HITL or auto-mutate strategy when duplicate risk is high

Expected benefit:

- avoids wasted final publish attempts
- creates cleaner operator experience
- turns a platform rejection into a deterministic workflow branch

### Priority 2: Copy-mutation fallback strategy

When X rejects a post as duplicate, the workflow should support a policy-driven next step instead of just failing.

Potential strategy:

- branch to `duplicate_content_resolution`
- propose 2-3 minimally changed text variants
- require HITL approval before retrying

Important constraint:

- do not silently mutate user-provided public copy without explicit approval

### Priority 3: Restore-session startup hygiene

The latest screenshot shows Chromium startup clutter that should be cleaned up:

- `Restore pages? Chromium didn't shut down correctly`
- unsupported flag banner for `--no-sandbox`

Both create noise during HITL review and may interfere with future vision steps.

Recommended work:

- suppress or close the restore-pages prompt deterministically
- review whether the current launch flags can be tightened for local headed runs
- add a startup normalization step for recurring test sessions

### Priority 4: Final confirmation UX copy and capture quality

The final confirmation path is structurally correct, but it can be made more useful.

Enhancements:

- require reason text when marking final failure
- auto-suggest reason text from known error banners or toasts
- surface the last agent evidence summary directly in the HITL UI

This will improve SIC quality and reduce operator friction.

### Priority 5: Social workflow outcome classification

The current workflow correctly reached final confirmation, but social outcomes should be classified more explicitly.

Suggested classifications:

- `published`
- `duplicate_rejected`
- `rate_limited`
- `auth_lost`
- `composer_lost_draft`
- `unknown_publish_failure`

This should feed telemetry, wrap-up ETL, and SIC triggers.

### Priority 6: `browser-use` dependency stabilization

The runtime repeatedly reports:

- current version `0.12.2`
- newer version available `0.12.6`

The next team should decide whether to:

- pin and keep patching `0.12.2`
- or upgrade to `0.12.6` and revalidate the shared-session lifecycle behavior

Recommendation:

- test upgrade in an isolated branch with the same X workflow regression
- keep the new bridge recovery logic even if the upstream version improves lifecycle handling

### Priority 7: Better recurring-portal memory use

The recurring workflow knew the strongest correlation existed, but it did not yet reason far enough ahead to infer that identical post content itself might be the next failure mode.

Fine-tuning direction:

- enrich task metadata for recurring social workflows
- store outcome patterns like `duplicate content rejection`
- surface those patterns in pre-flight as executable risk hints

This is likely the highest-value SIC-driven enhancement after the duplicate-post precheck.

## Suggested Engineering Work Plan

### Phase 1

- add duplicate-content precheck
- add structured failure classification for social publishing
- require final-failure reason text in HITL UI

### Phase 2

- add approved-copy mutation retry branch
- clean up startup prompts and restore-page noise
- enrich recurring workflow metadata with prior publish outcomes

### Phase 3

- evaluate `browser-use` upgrade to `0.12.6`
- regression test sequential shared-session agent tasks
- add targeted tests around publish-step lifecycle reuse

## Files Most Relevant To The Next Team

- [src/workflow/types.ts](/home/spoq/ai-vision/src/workflow/types.ts)
- [src/workflow/engine.ts](/home/spoq/ai-vision/src/workflow/engine.ts)
- [src/session/hitl.ts](/home/spoq/ai-vision/src/session/hitl.ts)
- [src/session/types.ts](/home/spoq/ai-vision/src/session/types.ts)
- [src/ui/server.ts](/home/spoq/ai-vision/src/ui/server.ts)
- [src/session/manager.ts](/home/spoq/ai-vision/src/session/manager.ts)
- [src/engines/browser-use/server/main.py](/home/spoq/ai-vision/src/engines/browser-use/server/main.py)
- [src/workflow/wrap-up.ts](/home/spoq/ai-vision/src/workflow/wrap-up.ts)
- [src/telemetry/manager.ts](/home/spoq/ai-vision/src/telemetry/manager.ts)

## Acceptance Criteria For Fine-Tuning Completion

The next team should consider the fine-tuning effort complete when:

- the workflow detects duplicate-post risk before final publish
- duplicate rejections are classified explicitly and persisted as structured outcomes
- the startup browser chrome is normalized enough that HITL sees a clean portal
- final-failure reasons are always captured cleanly for SIC
- repeated X workflow runs no longer require manual interpretation to distinguish app failure from platform rejection

## Recommended Immediate Operator Note

For this specific Alaska complaint post, the exact text should not be retried unchanged on the same X account. A modified variant or a threaded follow-up strategy is required if the goal is to publish additional related content.
