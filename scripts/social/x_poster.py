import time
from playwright.sync_api import TimeoutError as PWTimeout
from .base import SocialPoster, Post, PostResult

COMPOSE_BTN = '[data-testid="SideNav_NewTweet_Button"]'
TWEET_BOX   = '[data-testid="tweetTextarea_0"]'
POST_BTN    = '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]'


class XPoster(SocialPoster):
    platform = "X"

    def login(self) -> None:
        print("[X] Opening x.com — log in if prompted (up to 2 min)...")
        self.page.goto("https://x.com", wait_until="domcontentloaded")
        self.page.wait_for_selector(
            '[data-testid="SideNav_NewTweet_Button"], [data-testid="primaryColumn"]',
            timeout=120_000,
        )
        print("[X] Logged in.")

    def post(self, content: Post) -> PostResult:
        try:
            try:
                self.page.click(COMPOSE_BTN, timeout=8_000)
            except PWTimeout:
                self.page.goto("https://x.com/compose/post", wait_until="networkidle")

            self.page.wait_for_selector(TWEET_BOX, timeout=15_000)
            time.sleep(0.4)

            box = self.page.locator(TWEET_BOX).first
            box.click()
            box.fill("")
            box.type(content.body, delay=8)
            time.sleep(0.6)

            btn = self.page.locator(POST_BTN).first
            btn.wait_for(state="visible", timeout=10_000)
            btn.click()
            time.sleep(3)

            print("[X] Post submitted.")
            return PostResult(platform=self.platform, success=True)
        except Exception as exc:
            return PostResult(platform=self.platform, success=False, error=str(exc))
