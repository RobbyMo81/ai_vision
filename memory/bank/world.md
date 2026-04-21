# World Knowledge — Platform Quirks

Last updated: 2026-04-20

## General Browser Automation Quirks

- **Dynamic dropdowns**: Many modern web dropdowns (React Select, Salesforce Lightning) require a click → wait for options to render → second click on the target option. A single click often dismisses the menu without selecting.
- **Autocomplete fields**: Type slowly or the autocomplete suggestion list may not appear. After typing, wait for the dropdown to fully render before pressing Enter or clicking.
- **File upload inputs**: Hidden `<input type="file">` elements cannot be clicked directly via Playwright. Use `page.setInputFiles()` instead of simulating a click.
- **Shadow DOM elements**: Components inside Shadow DOM are not reachable with standard CSS selectors. Use `page.locator('css=host >>> child')` or pierce the shadow root explicitly.
- **CAPTCHA / bot detection**: Sites with Cloudflare, hCaptcha, or reCAPTCHA v3 will silently rate-limit or block headless browsers. Use `headless: false` and introduce human-like delays when hitting these pages.
- **Timing / race conditions**: SPAs frequently update the DOM after an XHR completes. Always await `networkidle` or use `waitForSelector` on a post-load element rather than a fixed `sleep`.
- **Modal focus traps**: Some modals trap keyboard focus. Attempting to interact with elements outside the modal will fail silently. Close or dismiss the modal first.
- **Scroll-into-view**: Elements below the fold may report as "not visible" even when present in the DOM. Call `element.scrollIntoViewIfNeeded()` before interacting.
- **iframe content**: Cross-origin iframes cannot be accessed. Same-origin iframes require switching the frame context with `page.frameLocator()`.
- **Sticky cookie/session banners**: These overlay interactive elements and block clicks. Dismiss consent banners before proceeding with page interaction.

## Browser-Use Specific

- The FastAPI bridge server must be fully up (health check passes) before any task is dispatched. Cold starts can take 3–5 seconds.
- Browser-Use agents work best with explicit, step-by-step task descriptions. Vague instructions like "post something" produce inconsistent results.
- Screenshot capture from Browser-Use sessions must be requested explicitly; sessions do not auto-save screenshots.

## Stagehand / Playwright Specific

- Stagehand's AI-based selectors (`act`, `extract`) work well for ambiguous UI but add ~500 ms latency per action. Use standard Playwright locators when the selector is deterministic.
- Playwright `page.goto()` resolves on `load`, not `networkidle`. For SPAs, always pass `{ waitUntil: 'networkidle' }` or wait for a sentinel element.
