#!/usr/bin/env python3
"""
Coordinated social poster — publishes one piece of content to X and Reddit
in a single headed Playwright session.

Usage:
    python3 scripts/social/post.py
    python3 scripts/social/post.py --subreddit stocks
    python3 scripts/social/post.py --platform x          # X only
    python3 scripts/social/post.py --platform reddit      # Reddit only
"""

import argparse
import time
from playwright.sync_api import sync_playwright
from .base import Post
from .x_poster import XPoster
from .reddit_poster import RedditPoster

# ---------------------------------------------------------------------------
# Content
# ---------------------------------------------------------------------------

TITLE = "Markets are repricing risk — are you positioned for it?"

BODY = """\
Markets are telling a story right now that most people aren't reading closely enough.

Volatility isn't the enemy — it's information. When the VIX spikes and breadth collapses, \
the crowd panics. But that's historically when the asymmetry flips in favor of patient capital.

The companies with strong free cash flow, low leverage, and pricing power don't disappear \
in a downturn. They widen their moats while weaker competitors bleed out.

What most retail investors call a "crash" is what long-term compounders call a discount window.

The market isn't broken. It's doing exactly what it's supposed to — repricing risk. \
The question is whether you're positioned to absorb that volatility or forced to sell into it.

Stay liquid. Stay selective. Ignore the noise.\
"""

# ---------------------------------------------------------------------------
# Coordinator
# ---------------------------------------------------------------------------

def run(platforms: list[str], subreddit: str):
    content = Post(title=TITLE, body=BODY)
    results = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, slow_mo=50)

        if "x" in platforms:
            ctx = browser.new_context(viewport={"width": 1280, "height": 900})
            x = XPoster(ctx.new_page())
            x.login()
            results.append(x.post(content))
            ctx.close()

        if "reddit" in platforms:
            ctx = browser.new_context(viewport={"width": 1280, "height": 900})
            r = RedditPoster(ctx.new_page(), subreddit=subreddit)
            r.login()
            results.append(r.post(content))
            ctx.close()

        print("\n--- Results ---")
        all_ok = True
        for res in results:
            status = "OK" if res.success else f"FAILED — {res.error}"
            url_part = f"  {res.url}" if res.url else ""
            print(f"  {res.platform}: {status}{url_part}")
            if not res.success:
                all_ok = False

        time.sleep(4)
        browser.close()

    return 0 if all_ok else 1


def main():
    parser = argparse.ArgumentParser(description="Post to X and/or Reddit")
    parser.add_argument(
        "--platform",
        choices=["x", "reddit", "both"],
        default="both",
        help="Which platform(s) to post to (default: both)",
    )
    parser.add_argument(
        "--subreddit",
        default="investing",
        help="Subreddit to post in (default: investing)",
    )
    args = parser.parse_args()

    platforms = ["x", "reddit"] if args.platform == "both" else [args.platform]
    raise SystemExit(run(platforms, args.subreddit))


if __name__ == "__main__":
    main()
