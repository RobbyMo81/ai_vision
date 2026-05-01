#!/usr/bin/env python3
"""
TikTok account creation via phone/SMS signup (headed Playwright).

Flow:
  1. Open TikTok signup in a visible browser
  2. Auto-fill phone number and request SMS code
  3. PAUSE — user enters the SMS code in the browser
  4. PAUSE — user sets a password in the browser
  5. Auto-try username candidates in order; skip taken ones
  6. Complete any remaining onboarding steps
"""

import time
from playwright.sync_api import Page, TimeoutError as PWTimeout

PHONE_NUMBER = "2066056901"
COUNTRY_CODE = "+1"

USERNAME_CANDIDATES = [
    "capital.signal",
    "market.moat",
    "alpha.compounding",
    "volatility.edge",
]

# ---------------------------------------------------------------------------
# Selectors — TikTok's DOM shifts often; kept intentionally flexible
# ---------------------------------------------------------------------------
PHONE_INPUT      = 'input[name="mobile"], input[type="tel"], input[placeholder*="phone" i]'
SEND_CODE_BTN    = 'button:has-text("Send code"), button:has-text("Send Code")'
CODE_INPUT       = 'input[name="code"], input[placeholder*="code" i], input[placeholder*="Enter 6" i]'
NEXT_BTN         = 'button:has-text("Next"), button[type="submit"]:not([disabled])'
PASSWORD_INPUT   = 'input[type="password"]'
USERNAME_INPUT   = 'input[name="nickname"], input[placeholder*="username" i]'
USERNAME_ERROR   = '[class*="error" i], [class*="tip" i]'
CONFIRM_BTN      = 'button:has-text("Confirm"), button:has-text("Sign up"), button[type="submit"]:not([disabled])'
TAKEN_SIGNALS    = ("already been taken", "not available", "try another", "already exists")


def _pause(msg: str) -> None:
    input(f"\n{'─'*60}\n{msg}\nPress ENTER when done...\n{'─'*60}\n")


def _click_if_visible(page: Page, selector: str, timeout: int = 5_000) -> bool:
    try:
        page.click(selector, timeout=timeout)
        return True
    except PWTimeout:
        return False


def run(page: Page) -> bool:
    print("\n[TikTok] Navigating to signup page...")
    page.goto("https://www.tiktok.com/signup/phone-or-email/phone", wait_until="domcontentloaded")
    time.sleep(2)

    # Some regions land on a generic signup page — click the phone option if present
    _click_if_visible(page, 'a:has-text("Use phone"), button:has-text("Phone")')
    time.sleep(1)

    # ── Step 1: Phone number ─────────────────────────────────────────────────
    print(f"[TikTok] Entering phone number {COUNTRY_CODE} {PHONE_NUMBER}...")
    try:
        page.wait_for_selector(PHONE_INPUT, timeout=15_000)
        phone_box = page.locator(PHONE_INPUT).first
        phone_box.click()
        phone_box.fill(PHONE_NUMBER)
        time.sleep(0.5)
    except PWTimeout:
        print("[TikTok] Could not find phone input — please enter the number manually.")
        _pause("Enter your phone number in the browser, then click 'Send code'")

    # Click "Send code"
    sent = _click_if_visible(page, SEND_CODE_BTN, timeout=8_000)
    if not sent:
        _pause("Click 'Send code' in the browser when ready")

    # ── Step 2: SMS verification code ───────────────────────────────────────
    _pause(
        f"📱 An SMS code was sent to {COUNTRY_CODE} {PHONE_NUMBER}.\n"
        "   Enter the 6-digit code in the browser, then click Next/Continue."
    )

    # ── Step 3: Password ─────────────────────────────────────────────────────
    # Check if a password field appeared; if not, TikTok may have skipped it
    has_password = False
    try:
        page.wait_for_selector(PASSWORD_INPUT, timeout=8_000)
        has_password = True
    except PWTimeout:
        pass

    if has_password:
        _pause(
            "🔑 Create a strong password in the browser password field,\n"
            "   then click Next/Continue."
        )

    # ── Step 4: Username ─────────────────────────────────────────────────────
    print("[TikTok] Waiting for username field...")
    try:
        page.wait_for_selector(USERNAME_INPUT, timeout=20_000)
    except PWTimeout:
        print("[TikTok] Username field not detected — may appear after onboarding.")
        _pause("Complete any onboarding steps until the username field appears, then press ENTER.")

    chosen = None
    for candidate in USERNAME_CANDIDATES:
        print(f"[TikTok] Trying username: {candidate}")
        try:
            ubox = page.locator(USERNAME_INPUT).first
            ubox.click()
            ubox.fill("")
            ubox.fill(candidate)
            time.sleep(1.2)  # wait for inline validation

            # Check for "taken" error text
            error_els = page.locator(USERNAME_ERROR).all()
            taken = any(
                any(sig in (el.inner_text() or "").lower() for sig in TAKEN_SIGNALS)
                for el in error_els
            )
            if not taken:
                chosen = candidate
                print(f"[TikTok] Username '{candidate}' appears available.")
                break
            else:
                print(f"[TikTok] '{candidate}' is taken, trying next...")
        except Exception as exc:
            print(f"[TikTok] Error checking username: {exc}")
            break

    if not chosen:
        _pause(
            "⚠️  All suggested usernames were taken.\n"
            "    Enter a username manually in the browser, then press ENTER."
        )
    else:
        # Click Confirm/Sign up
        confirmed = _click_if_visible(page, CONFIRM_BTN, timeout=8_000)
        if not confirmed:
            _pause("Click the Confirm / Sign Up button in the browser, then press ENTER.")

    # ── Step 5: Any remaining onboarding ────────────────────────────────────
    _pause(
        "🎉 Complete any remaining TikTok onboarding steps\n"
        "   (interests, follow suggestions, etc.), then press ENTER."
    )

    print(f"\n[TikTok] Account setup complete!")
    if chosen:
        print(f"  Username : @{chosen}")
    print(f"  Phone    : {COUNTRY_CODE} {PHONE_NUMBER}")
    return True
