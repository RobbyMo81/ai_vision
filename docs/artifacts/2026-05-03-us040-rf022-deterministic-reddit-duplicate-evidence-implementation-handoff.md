# US-040 / RF-022 Implementation Handoff

## Agent Prompt

You are implementing `US-040 / RF-022: Deterministic Reddit Duplicate Evidence Producer` in the ai-vision repository. Follow the Forge workflow exactly.

Before editing code:

1. read `FORGE.md`;
2. read `AGENTS.md`;
3. read `prd.json`;
4. read `progress.txt`;
5. query Forge memory for current story state and unread messages;
6. read the source artifacts listed below.

Source artifacts:

- `docs/debriefs/2026-05-03-reddit-duplicate-check-stall-blast-radius.md`
- `docs/debriefs/2026-05-03-reddit-screenshot-recovery-implementation-story-plan.md`
- `workflows/post_to_reddit.yaml`
- `workflows/write_and_post_to_reddit.yaml`

## Build Target

Replace the direct Reddit duplicate-check evidence producer with deterministic TypeScript/Playwright logic. The direct `post_to_reddit` workflow should no longer rely on `browser-use` to collect Reddit titles, compute Jaccard scores, and format duplicate evidence.

## Expected Code Areas

Inspect these first:

- `src/workflow/engine.ts`
- `src/workflow/engine.test.ts`
- `src/workflow/types.ts`
- `workflows/post_to_reddit.yaml`
- `workflows/write_and_post_to_reddit.yaml`
- existing Reddit duplicate evidence parser and submit-gate tests

Prefer a small, testable helper for title normalization, Jaccard scoring, title extraction, and evidence rendering. Keep parser compatibility with the current evidence contract.

## Required Behavior

1. For direct `post_to_reddit`, execute `check_duplicate_reddit_post` through deterministic TypeScript/Playwright logic rather than `browser-use`.
2. Navigate to `https://www.reddit.com/r/{subreddit}/new`.
3. Collect recent titles using the documented selector strategy.
4. Score the candidate title against each collected title with word-level Jaccard.
5. Render the existing evidence contract:

```text
EXTRACTED_TITLES: <json array of all collected title strings>
OVERLAP_SCORES: <json array of objects, each with title and score fields>
DUPLICATE_CHECK_RESULT: NO_DUPLICATE_FOUND | DUPLICATE_RISK
MATCHING_TITLE: <matching title>  (only when DUPLICATE_CHECK_RESULT is DUPLICATE_RISK)
```

6. Navigate back to `/r/{subreddit}/submit` before the next workflow step.
7. Preserve existing submit-gate behavior.
8. Fail closed if no usable titles are collected.

## Selector Strategy

Primary selector:

```css
a[id^="post-title-"]
```

Fallback selectors:

```css
shreddit-post a[id^="post-title-"]
article a[id^="post-title-"]
[data-testid="post-title"]
h1, h2, h3
```

Rules:

- Use `textContent`.
- Drop empty strings.
- Drop standalone UI labels: `comment`, `comments`, `share`, `vote`, `promoted`, `advertisement`.
- Deduplicate case-insensitively.
- Bound to `50` usable titles.
- Do not infinite-scroll.
- Allow one bounded scroll-and-retry only if zero usable titles are found.

## Jaccard Rules

Normalize titles by lowercasing, trimming, collapsing whitespace, stripping punctuation except alphanumeric word boundaries, splitting on whitespace, dropping empty tokens, and deduplicating tokens.

Scoring:

```text
score = size(intersection(candidate_tokens, observed_tokens)) / size(union(candidate_tokens, observed_tokens))
```

Thresholds:

- `score >= 0.70`: `DUPLICATE_RISK`
- `0.50 <= score < 0.70`: near-match metadata only; canonical result remains `NO_DUPLICATE_FOUND` unless another title reaches `0.70`
- `score < 0.50`: no duplicate for that title

## Explicit Non-Goals

Do not implement:

- screenshot capture scheduler or hung-step guardrail from `US-041`;
- post-task screenshot TTL cleanup from `US-042`;
- changes that weaken Reddit submit evidence gates;
- screenshot payload, persistence, capture policy, retention audit, or evidence audit changes;
- agentic mode retirement;
- broad browser-use bridge refactors.

## Testing Requirements

Add focused tests proving:

1. normalization and Jaccard scoring;
2. duplicate risk at `>= 0.70`;
3. near-match scores are visible but do not create a third canonical result;
4. no-duplicate evidence passes the existing parser;
5. duplicate-risk evidence blocks `submit_reddit_post`;
6. missing/zero-title evidence fails closed;
7. selector fallback works when the primary selector has no usable titles;
8. direct `post_to_reddit` no longer dispatches `check_duplicate_reddit_post` to `browser-use`.

Run:

```bash
jq empty prd.json
pnpm run typecheck
pnpm test -- --runInBand src/workflow/engine.test.ts
```

Run full `pnpm test` if the workflow engine changes are broad.

## Closeout

When implementation is complete:

1. mark `US-040` complete in `prd.json`;
2. mark `RF-022` complete in `docs/SIC_REFACTOR_ENHANCEMENT_TRACKER.md`;
3. update this story card status to completed;
4. append a full history entry to `docs/history/forge_history.md`;
5. append a library-card row to `docs/history/history_index.md`;
6. update `progress.txt` with Summary of Work, files touched, acceptance criteria, and validation results;
7. write Forge memory story state and useful discoveries.
