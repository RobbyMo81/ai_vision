# Platform: Reddit

Last updated: 2026-04-20

## General

- Reddit uses React with client-side routing. Page navigation fires `pushState` events; wait for the post/comment feed to appear rather than relying on `load`.
- Old Reddit (`old.reddit.com`) is far more automatable than new Reddit — it uses server-rendered HTML with stable CSS classes.
- New Reddit rate-limits rapid successive actions. Insert a 1–2 second delay between posting, commenting, and voting.
- Login sessions expire; always verify `window.__reddit_session` or check for the username in the top-right nav before assuming you're logged in.

## r/test

- **Purpose**: Safe sandbox subreddit for testing post/comment automation without violating community rules.
- **Post types allowed**: Text, link, image — no restrictions.
- **Moderation**: Minimal; posts are rarely removed. Ideal for end-to-end workflow verification.
- **Observed quirks**:
  - Flairs are optional; skip flair selection to keep submission flow simple.
  - The "Post" submit button is disabled until the title field has at least 1 character. Fill title before body.
  - After submission, Reddit redirects to the new post URL. Capture this URL for verification.

## r/artificial

- **Purpose**: Active community for AI/ML discussion. Use only for genuine, on-topic posts.
- **Moderation**: Active moderators; spam or off-topic posts are removed quickly.
- **Post requirements**:
  - Title must accurately describe the AI topic.
  - Link posts require a source URL; text posts require substantive content (not just a headline).
  - Image-only posts are frequently removed — always include descriptive text.
- **Observed quirks**:
  - Karma gate: accounts with less than ~10 karma may have posts held for moderator review.
  - NSFW toggle is disabled for this subreddit by moderator policy — do not attempt to set it.
  - Comment sorting defaults to "Top"; scraping comment sentiment should sort by "New" to catch recent activity.
  - The subreddit sidebar loads asynchronously. Rules are not available in the initial DOM snapshot.

## Submission Flow (New Reddit UI)

1. Navigate to `https://www.reddit.com/r/<subreddit>/submit`.
2. Wait for the post type tabs ("Post", "Image & Video", "Link") to render.
3. Click the "Post" tab for text submissions.
4. Fill in the `#post-title` field.
5. Click into the body editor (Quill-based rich text); type content.
6. Wait for the submit button to become enabled (`aria-disabled` attribute removed).
7. Click submit and wait for redirect to the new post URL.
8. Capture and log the final URL as confirmation.
