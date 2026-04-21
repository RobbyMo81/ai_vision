/**
 * Direct Playwright cleanup: find and delete all Aladdin Trap posts on r/test.
 * Navigates to each post individually to avoid stale-element issues.
 *
 * Usage: node scripts/cleanup_reddit_posts.mjs
 */

import { chromium } from 'playwright';

const CDP_URL  = process.env.BROWSER_CDP_URL || 'http://localhost:9223';
const SUBREDDIT = 'test';
const TITLE_MATCH = 'Aladdin Trap';
// Use old Reddit — simple static HTML, reliable selectors
const PROFILE_URL = 'https://old.reddit.com/user/Infinite_Pop_6624/submitted';

async function findPostUrls(page) {
  await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // old.reddit post title links: <a class="title">
  const links = await page.$$eval('a.title', (anchors, match) =>
    anchors
      .filter(a => a.textContent.includes(match))
      .map(a => {
        // Convert www to old so we stay on old Reddit for deletion
        return a.href.replace('https://www.reddit.com', 'https://old.reddit.com');
      }),
    TITLE_MATCH
  );

  return [...new Set(links)];
}

async function deletePost(page, postUrl) {
  await page.goto(postUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // old Reddit: delete button is a plain <a class="delete-thing"> inside .flat-list.buttons
  const deleteLink = page.locator('.flat-list.buttons a.delete-thing, .flat-list a[data-event-action="delete"]').first();
  const visible = await deleteLink.isVisible({ timeout: 3000 }).catch(() => false);
  if (!visible) {
    console.error(`  ✗ Delete button not found at ${postUrl} — may not be owner or already deleted`);
    return false;
  }

  await deleteLink.click();
  await page.waitForTimeout(600);

  // Confirm dialog (old Reddit uses a JS confirm() or inline button)
  page.once('dialog', async dialog => { await dialog.accept(); });
  await page.waitForTimeout(1000);

  console.log(`  ✓ Deleted: ${postUrl}`);
  return true;
}

(async () => {
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = context.pages()[0] ?? await context.newPage();

    console.log(`Scanning r/${SUBREDDIT}/new for "${TITLE_MATCH}" posts...`);
    const urls = await findPostUrls(page);

    if (urls.length === 0) {
      console.log('No matching posts found — r/test is clean.');
      return;
    }

    console.log(`Found ${urls.length} post(s) to delete:`);
    urls.forEach(u => console.log(' ', u));

    let deleted = 0;
    for (const url of urls) {
      try {
        await deletePost(page, url);
        deleted++;
      } catch (err) {
        console.error(`  ✗ Failed to delete ${url}: ${err.message}`);
      }
    }

    console.log(`\nDone. Deleted ${deleted}/${urls.length} posts.`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
})();
