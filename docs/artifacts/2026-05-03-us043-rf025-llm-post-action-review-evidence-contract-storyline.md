# US-043 / RF-025 Storyline: LLM Post-Action Review Evidence Contract

Use the Forge system and Forge build loop for this story.

## Problem

The 2026-05-03 live `post_to_reddit` status-update run proved that the browser-use LLM can correctly interpret messy post-action outcomes that the deterministic browser postcondition currently rejects.

Observed production shape:

1. `submit_reddit_post` clicked Reddit's Post button.
2. Reddit accepted the post and redirected to `https://www.reddit.com/r/test/?created=t3_1t2zy4d...`.
3. The browser-use LLM review correctly reported the created post id, canonical comments URL, visible title, and successful submission.
4. The deterministic browser postcondition required the address bar to contain `/comments/`.
5. The workflow ended as failed with `expected_url_missing` even though the Reddit post was live and visible.

The system should use LLM reasoning as structured evidence, not as unchecked authority. Deterministic gates should remain final authority, but they need to consume and validate LLM post-action observations instead of discarding them.

## Goal

Add a typed LLM post-action review evidence contract for side-effecting `agent_task` steps so the workflow kernel can compare:

- current URL evidence;
- DOM/page evidence;
- structured LLM observations;
- existing postcondition rules;
- HITL fallback requirements when these signals disagree.

## Scope

This story is focused on the evidence contract and first Reddit submit integration.

In scope:

1. Define a structured `PostActionReviewEvidence` contract for LLM/browser-use side-effect steps.
2. Require side-effecting `agent_task` steps to return or be parsed into structured review evidence when available.
3. Add parser support for browser-use final output fields such as created id, canonical URL, visible title, visible body, action taken, confidence, and risk flags.
4. Extend the Reddit submit postcondition to accept verified success when:
   - current URL contains `/comments/<id>`; or
   - current URL contains `?created=t3_<id>` and the visible page or LLM evidence confirms the matching title/body; or
   - LLM evidence provides a canonical comments URL plus the browser/DOM confirms the matching created post.
5. If LLM evidence says success but deterministic URL/DOM evidence cannot corroborate it, pause HITL review with the disagreement instead of marking a blind failure.
6. Emit byte-free telemetry for post-action evidence accepted, rejected, or escalated to HITL.
7. Preserve existing approval gates, duplicate-check gates, and browser postcondition safety boundaries.

Out of scope:

1. Making the LLM the final authority for irreversible actions.
2. Removing deterministic postconditions.
3. General social-platform postcondition rewrites beyond the minimal reusable contract and Reddit submit integration.
4. Screenshot retention cleanup from planned `US-042 / RF-024`.
5. Browser-use version upgrades.

## Required Contract Shape

The implementation may refine names, but the contract must preserve these semantics:

```ts
interface PostActionReviewEvidence {
  stepId: string;
  actionTaken: string;
  observedSuccess: boolean;
  observedSuccessSignal?: string;
  createdId?: string;
  canonicalUrl?: string;
  currentUrl?: string;
  visibleTitle?: string;
  visibleBodyExcerpt?: string;
  confidence?: 'low' | 'medium' | 'high';
  riskFlags: string[];
  rawEvidence?: string;
}
```

The persisted workflow result must remain byte-free and must not store screenshot base64.

## HITL Review Behavior

When post-action evidence and deterministic checks disagree, the workflow must not silently choose either side. It should enter `hitl_qa` with:

- the step id;
- deterministic failure reason;
- LLM observed success signal;
- current URL;
- canonical URL if present;
- visible title/body match status if available;
- clear operator choices to accept evidence, reject evidence, or record notes and close.

The first implementation can use the existing HITL QA surface if a richer accept/reject UI would broaden scope, but the state and telemetry must preserve the disagreement.

## Acceptance Criteria

1. Side-effecting `agent_task` results can carry structured post-action review evidence.
2. Reddit submit recognizes `?created=t3_<id>` plus corroborated title/body evidence as a successful publish signal.
3. Reddit submit still accepts normal `/comments/<id>` success URLs.
4. Reddit submit still fails or pauses when no corroborating post-action evidence exists.
5. Missing or malformed LLM evidence does not bypass deterministic gates.
6. LLM-success/deterministic-failure disagreement enters HITL review instead of creating a false terminal failure.
7. Telemetry records post-action evidence decisions without screenshot bytes or sensitive page content.
8. Existing duplicate-check, approval, and postcondition tests continue to pass.

## Exit Criteria

Exit only when the workflow kernel can use structured LLM post-action review as corroborating evidence for Reddit submit outcomes, false failures caused by Reddit's `created=t3_...` redirect are eliminated, and disagreements route to HITL review with enough context for an operator to decide.

