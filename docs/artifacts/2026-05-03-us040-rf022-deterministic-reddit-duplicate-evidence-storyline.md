# US-040 / RF-022: Deterministic Reddit Duplicate Evidence Producer Storyline

## Forge Directive

Use the Forge build loop for this story. Read `FORGE.md`, `AGENTS.md`, `prd.json`, `progress.txt`, Forge memory state, and the linked Reddit/screenshot investigation documents before writing code.

## Story

As the ai-vision workflow platform, I need Reddit duplicate-check evidence to be produced deterministically before submit so the direct Reddit posting workflow does not depend on a broad browser-use prompt for title collection, similarity scoring, and strict evidence formatting.

## Problem

Two headed `post_to_reddit` production-test attempts against `r/test` reached `check_duplicate_reddit_post`, then stalled inside the `browser-use` task. The agent reached `/r/test/new`, found roughly 50 post title elements, and then stalled while trying to extract and score titles.

The submit gate worked: no unsafe Reddit post was created. The failure is that the duplicate-check evidence producer is too important to leave to an LLM/browser-use prompt.

## Scope

Implement a deterministic TypeScript/Playwright duplicate evidence producer for the direct `post_to_reddit` workflow.

The story owns:

1. replacing the direct workflow `check_duplicate_reddit_post` execution path with deterministic title collection and scoring;
2. collecting recent Reddit titles from `/r/{subreddit}/new` using bounded DOM selectors;
3. computing word-level Jaccard similarity in TypeScript;
4. preserving the existing four-line evidence contract consumed by the parser and submit gate;
5. failing closed when Reddit DOM drift prevents title collection;
6. leaving the existing `submit_reddit_post` duplicate evidence gate unchanged;
7. adding focused tests for duplicate, near-match, no-duplicate, zero-title, selector fallback, and parser compatibility.

## Required Evidence Contract

The deterministic step must still produce output compatible with the existing parser:

```text
EXTRACTED_TITLES: <json array of all collected title strings>
OVERLAP_SCORES: <json array of objects, each with title and score fields>
DUPLICATE_CHECK_RESULT: NO_DUPLICATE_FOUND | DUPLICATE_RISK
MATCHING_TITLE: <matching title>  (only when DUPLICATE_CHECK_RESULT is DUPLICATE_RISK)
```

Do not introduce a third canonical result value. Near-match review is metadata only.

## Thresholds

Use word-level Jaccard similarity after normalization.

| Score range | Classification | Submit behavior |
| --- | --- | --- |
| `>= 0.70` | `DUPLICATE_RISK` | Block `submit_reddit_post`; include `MATCHING_TITLE`. |
| `>= 0.50` and `< 0.70` | Near-match metadata | Do not block submit under the existing contract; keep score visible in `OVERLAP_SCORES`. |
| `< 0.50` | `NO_DUPLICATE_FOUND` | Allow submit if the evidence contract is valid. |

## DOM Selector Strategy

Primary selector:

```css
a[id^="post-title-"]
```

Fallback selectors, evaluated in order only when the prior selector returns no usable titles:

```css
shreddit-post a[id^="post-title-"]
article a[id^="post-title-"]
[data-testid="post-title"]
h1, h2, h3
```

## Extraction Rules

1. Use `textContent`.
2. Trim each title.
3. Drop empty strings.
4. Drop standalone UI labels: `comment`, `comments`, `share`, `vote`, `promoted`, `advertisement`.
5. Deduplicate case-insensitively while preserving first-seen display text.
6. Limit to the first `50` usable titles.
7. Do not infinite-scroll.
8. Allow at most one bounded scroll-and-retry when zero usable titles are found.

## Jaccard Rules

Normalize candidate and observed titles before scoring:

1. lowercase;
2. trim;
3. collapse internal whitespace;
4. strip punctuation except alphanumeric word boundaries;
5. split on whitespace;
6. remove empty tokens;
7. deduplicate tokens.

Formula:

```text
score = size(intersection(candidate_tokens, observed_tokens)) / size(union(candidate_tokens, observed_tokens))
```

If both token sets are empty, score `0.0`.

Complexity must remain bounded:

```text
n = collected titles, capped at 50
m = average normalized title token count
c = candidate title token count

normalization: O(n * m + c)
scoring:       O(n * (m + c))
memory:        O(n * m)
```

Only compare the candidate title against observed titles. Do not perform pairwise title-to-title comparisons.

## Out Of Scope

Do not implement these in this story:

1. changing the Reddit submit safety gate;
2. weakening duplicate evidence validation;
3. screenshot capture scheduler or hung-step guardrail from planned `US-041`;
4. post-task screenshot TTL cleanup from planned `US-042`;
5. retiring `mode: agentic`;
6. broad browser-use bridge changes unless needed to remove this direct duplicate-check dependency.

## Critical Edge Rules

1. If no usable titles are collected, return a failed step and do not produce `NO_DUPLICATE_FOUND`.
2. If Reddit navigation to `/new` fails, fail closed.
3. If selector fallback is used, telemetry should identify which selector succeeded.
4. If any score is `>= 0.70`, the result must be `DUPLICATE_RISK`.
5. Near matches between `0.50` and `0.70` must remain visible in `OVERLAP_SCORES` but must not create a third canonical result.
6. The direct submit gate must still be the final blocker before `submit_reddit_post`.

## References

- `docs/debriefs/2026-05-03-reddit-duplicate-check-stall-blast-radius.md`
- `docs/debriefs/2026-05-03-reddit-screenshot-recovery-implementation-story-plan.md`
- `workflows/post_to_reddit.yaml`
- `workflows/write_and_post_to_reddit.yaml`
- `src/workflow/engine.ts`
- `src/workflow/engine.test.ts`

## Exit

Exit only when direct `post_to_reddit` produces deterministic duplicate evidence without browser-use for `check_duplicate_reddit_post`, the existing parser and submit gate still enforce duplicate safety, DOM drift fails closed, and focused tests plus typecheck pass.
