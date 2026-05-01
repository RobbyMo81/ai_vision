#!/usr/bin/env python3
"""Entry point: python3 -m scripts.social.setup_tiktok"""

import time
from playwright.sync_api import sync_playwright
from .tiktok_setup import run


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False, slow_mo=40)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()

        success = run(page)

        print("\n[*] Keeping browser open for 10 seconds...")
        time.sleep(10)
        browser.close()

    raise SystemExit(0 if success else 1)


if __name__ == "__main__":
    main()
