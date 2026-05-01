# Reddit Workflow Run Note

Date: 2026-04-22

## Observed Issue

The built-in `write_and_post_to_reddit` workflow successfully generated Reddit post content, opened `r/test`, and submitted a post, but the final submit-stage handoff lost the generated title/body context.

## Evidence

- Gemini draft generation completed with a title/body payload.
- The duplicate-check prompt received an empty title.
- The draft composer step reached Reddit with blank title/body context.
- The browser-use agent fell back to a synthetic title: `Test post - automated workflow verification`.
- The post was successfully published to:
  - `https://www.reddit.com/r/test/comments/1st8n32/test_post_automated_workflow_verification/`

## Failure Shape

- The publish path works.
- The content propagation path into the submit step does not.
- A trace call is needed across the three LLM layers to pinpoint where the payload is dropped.

## Notes

- The submit step should receive the generated `reddit_post_title` and `reddit_post_text`, not fallback text.
- The browser agent currently has enough context to recover, but that recovery masks the upstream propagation defect.
