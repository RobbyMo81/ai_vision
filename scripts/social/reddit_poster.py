import time
from playwright.sync_api import TimeoutError as PWTimeout
from .base import SocialPoster, Post, PostResult

DEFAULT_SUBREDDIT = "investing"

SUBMIT_BTN      = 'button[type="submit"]:has-text("Post")'
TEXT_TAB        = 'button:has-text("Text")'
TITLE_INPUT     = '[placeholder="Title"]'
BODY_EDITOR     = '.public-DraftEditor-content, [data-testid="post-composer-richtext"] div[contenteditable="true"]'
LOGIN_INDICATOR = '#USER_DROPDOWN_ID, [data-testid="user-dropdown-button"], a[href="/submit"]'


class RedditPoster(SocialPoster):
    platform = "Reddit"

    def __init__(self, page, subreddit: str = DEFAULT_SUBREDDIT):
        super().__init__(page)
        self.subreddit = subreddit

    def login(self) -> None:
        print(f"[Reddit] Opening reddit.com — log in if prompted (up to 2 min)...")
        self.page.goto("https://www.reddit.com/login", wait_until="domcontentloaded")
        self.page.wait_for_selector(LOGIN_INDICATOR, timeout=120_000)
        print("[Reddit] Logged in.")

    def post(self, content: Post) -> PostResult:
        url = f"https://www.reddit.com/r/{self.subreddit}/submit"
        try:
            self.page.goto(url, wait_until="domcontentloaded")

            # Select the "Text" tab if the composer shows multiple post types
            try:
                self.page.click(TEXT_TAB, timeout=5_000)
                time.sleep(0.4)
            except PWTimeout:
                pass

            # Title
            self.page.wait_for_selector(TITLE_INPUT, timeout=15_000)
            title_box = self.page.locator(TITLE_INPUT).first
            title_box.click()
            title_box.fill(content.title or content.body[:100])
            time.sleep(0.3)

            # Body
            body_box = self.page.locator(BODY_EDITOR).first
            body_box.click()
            body_box.type(content.body, delay=8)
            time.sleep(0.6)

            # Submit
            submit = self.page.locator(SUBMIT_BTN).first
            submit.wait_for(state="visible", timeout=10_000)
            submit.click()

            # Wait for redirect to the new post
            self.page.wait_for_url("**/comments/**", timeout=20_000)
            post_url = self.page.url
            print(f"[Reddit] Post live: {post_url}")
            return PostResult(platform=self.platform, success=True, url=post_url)
        except Exception as exc:
            return PostResult(platform=self.platform, success=False, error=str(exc))
