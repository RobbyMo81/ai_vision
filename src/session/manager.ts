/**
 * Shared browser session manager.
 *
 * Owns a SINGLE Playwright browser instance that persists for the lifetime of
 * the `ai-vision serve` process.  All workflow steps (navigate, click, type,
 * screenshot, extract) operate on this shared page so that auth cookies and
 * DOM state are preserved across HITL handoffs and engine switches.
 *
 * Python bridges that need the same Chrome session connect via the CDP URL
 * exposed by getCdpUrl().  Set BROWSER_CDP_URL in their environment and they
 * will attach to this browser instead of spawning a new one.
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { ChildProcess, spawn, execSync } from 'child_process';
import { telemetry } from '../telemetry';

export interface SessionManagerOptions {
  /** Show the browser window (required for HITL so the user can interact). */
  headed?: boolean;
  /** Chrome remote-debugging port.  Default: 9223 to avoid conflicts. */
  cdpPort?: number;
}

export class SessionManager extends EventEmitter {
  private chromeProcess: ChildProcess | null = null;
  private _browser: import('playwright-core').Browser | null = null;
  private _context: import('playwright-core').BrowserContext | null = null;
  private _page: import('playwright-core').Page | null = null;
  private readonly headed: boolean;
  private readonly cdpPort: number;
  private readonly userDataDir: string;
  private _started = false;
  private _screenshotTimer: ReturnType<typeof setInterval> | null = null;
  private readonly _screenshotDir: string;

  constructor(opts: SessionManagerOptions = {}) {
    super();
    this.headed = opts.headed ?? process.env.AI_VISION_HEADED === 'true';
    this.cdpPort = opts.cdpPort ?? parseInt(process.env.AI_VISION_CDP_PORT ?? '9223', 10);
    // Durable profile directory so Chrome "Saved Data" (cookies, credentials,
    // payment autofill) can persist across restarts.
    const home = process.env.HOME ?? process.cwd();
    this.userDataDir =
      process.env.AI_VISION_PROFILE_DIR ??
      path.join(home, '.ai-vision', 'profiles', 'default');
    this._screenshotDir = process.env.SESSION_DIR
      ? path.join(process.env.SESSION_DIR, 'rolling')
      : path.join(process.cwd(), 'sessions', 'rolling');
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Kill any process already holding the CDP port so Chrome can bind it. */
  private _evictPortHolder(): void {
    try {
      // Use fuser to find and kill the PID holding the port.
      execSync(`fuser -k ${this.cdpPort}/tcp 2>/dev/null`, { stdio: 'ignore' });
      // Give the OS a moment to release the socket.
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const probe = (() => {
          try {
            const s = require('net').createConnection({ host: '127.0.0.1', port: this.cdpPort });
            s.destroy();
            return false; // still occupied
          } catch {
            return true; // free
          }
        })();
        if (probe) break;
      }
    } catch {
      // fuser not available or port already free — proceed anyway
    }
  }

  async start(): Promise<void> {
    if (this._started) return;

    // Ensure no zombie Chrome from a previous run is squatting on the CDP port.
    this._evictPortHolder();

    telemetry.emit({
      source: 'session',
      name: 'session.browser.starting',
      details: {
        headed: this.headed,
        cdpPort: this.cdpPort,
        profileDir: this.userDataDir,
      },
    });

    const { chromium } = await import('playwright-core');

    // Try to find the Playwright-managed Chromium executable first.
    // Falls back to launching a new Playwright-managed browser if CDP approach fails.
    let chromiumExecPath: string | undefined;
    try {
      chromiumExecPath = chromium.executablePath();
    } catch {
      // Playwright browsers not installed — will use normal launch below
    }

    if (chromiumExecPath && fs.existsSync(chromiumExecPath)) {
      fs.mkdirSync(this.userDataDir, { recursive: true });
      // Launch Chrome directly with a remote debugging port so Python bridges
      // can attach to the same session via CDP.
      this.chromeProcess = spawn(chromiumExecPath, [
        `--remote-debugging-port=${this.cdpPort}`,
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        `--user-data-dir=${this.userDataDir}`,
        ...(this.headed ? ['--start-maximized'] : ['--headless=new']),
      ], { stdio: 'ignore' });

      this.chromeProcess.on('exit', (code) => {
        if (this._started) {
          console.error(`[session] Chrome exited with code ${code}`);
          telemetry.emit({
            source: 'session',
            name: 'session.browser.exited',
            level: 'error',
            details: { code: code ?? 'unknown' },
          });
          this._started = false;
        }
      });

      // Ensure Chrome is killed when the Node.js process exits for any reason
      // (SIGTERM from pkill, SIGINT from Ctrl+C, or uncaught exception).
      const killChrome = () => { try { this.chromeProcess?.kill('SIGTERM'); } catch { /* ignore */ } };
      process.once('exit', killChrome);
      process.once('SIGTERM', () => { killChrome(); process.exit(0); });
      process.once('SIGINT', () => { killChrome(); process.exit(0); });

      await this._waitForCdp();
      this._browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.cdpPort}`);
      const contexts = this._browser.contexts();
      this._context = contexts[0] ?? await this._browser.newContext();
      const pages = this._context.pages();
      this._page = pages[0] ?? await this._context.newPage();
    } else {
      // Fallback: use a persistent context so saved browser data survives even
      // when direct CDP boot is unavailable.
      fs.mkdirSync(this.userDataDir, { recursive: true });
      this._context = await chromium.launchPersistentContext(this.userDataDir, {
        headless: !this.headed,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
      this._browser = this._context.browser();
      const pages = this._context.pages();
      this._page = pages[0] ?? await this._context.newPage();
    }

    this._started = true;
    // Publish the CDP URL so PythonBridgeEngine subprocesses can attach to this browser
    process.env.BROWSER_CDP_URL = this.getCdpUrl();
    this.emit('started');
    telemetry.emit({
      source: 'session',
      name: 'session.browser.started',
      details: {
        headed: this.headed,
        cdpPort: this.cdpPort,
        profileDir: this.userDataDir,
        cdpUrl: this.getCdpUrl(),
      },
    });
  }

  async close(): Promise<void> {
    this._started = false;
    telemetry.emit({
      source: 'session',
      name: 'session.browser.closing',
      details: {
        profileDir: this.userDataDir,
      },
    });
    try { await this._context?.close(); } catch { /* ignore */ }
    try { await this._browser?.close(); } catch { /* ignore */ }
    this.chromeProcess?.kill('SIGTERM');
    this._browser = null;
    this._context = null;
    this._page = null;
    telemetry.emit({
      source: 'session',
      name: 'session.browser.closed',
      details: {
        profileDir: this.userDataDir,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Browser access
  // ---------------------------------------------------------------------------

  async getPage(): Promise<import('playwright-core').Page> {
    if (!this._started) await this.start();
    return this._page!;
  }

  /**
   * HTTP CDP endpoint for Python bridges (browser-use, skyvern).
   * Set BROWSER_CDP_URL=<this value> in the subprocess environment
   * and the bridge will attach to this browser instead of launching its own.
   */
  getCdpUrl(): string {
    return `http://127.0.0.1:${this.cdpPort}`;
  }

  get isStarted(): boolean {
    return this._started;
  }

  // ---------------------------------------------------------------------------
  // Actions (called directly by workflow engine for non-agent steps)
  // ---------------------------------------------------------------------------

  async navigate(url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'load'): Promise<void> {
    const page = await this.getPage();
    await page.goto(url, { waitUntil });
  }

  async click(selector: string): Promise<void> {
    const page = await this.getPage();
    await page.click(selector);
  }

  async type(selector: string, text: string, clearFirst = false): Promise<void> {
    const page = await this.getPage();
    if (clearFirst) await page.fill(selector, '');
    await page.type(selector, text);
  }

  /** Returns base64-encoded JPEG screenshot (80% quality for transport efficiency). */
  async screenshot(): Promise<string> {
    const page = await this.getPage();
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 80 });
      return buf.toString('base64');
    } catch (error) {
      telemetry.emit({
        source: 'session',
        name: 'session.browser.screenshot_failed',
        level: 'warn',
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async currentUrl(): Promise<string> {
    const page = await this.getPage();
    return page.url();
  }

  /**
   * After a browser-use agent task, the active tab may differ from the page
   * the SessionManager originally opened. This re-syncs _page to the most
   * recently active page in the shared context so the HITL panel screenshot
   * and currentUrl() reflect what the agent actually did.
   */
  async syncActivePage(): Promise<void> {
    if (!this._context || !this._started) return;
    try {
      const pages = this._context.pages();
      if (pages.length === 0) return;
      // The last page in the list is the most recently opened/focused one.
      const candidate = pages[pages.length - 1];
      // Ignore blank/internal pages — only switch if there's real content.
      const url = candidate.url();
      if (url && !url.startsWith('about:') && !url.startsWith('chrome://')) {
        this._page = candidate;
      } else if (pages.length > 1) {
        // Try to find any page with real content.
        const withContent = [...pages].reverse().find(
          p => !p.url().startsWith('about:') && !p.url().startsWith('chrome://')
        );
        if (withContent) this._page = withContent;
      }
    } catch {
      // Non-fatal — worst case the HITL panel shows a stale screenshot
    }
  }

  /**
   * Start a rolling screenshot every `intervalMs` ms (default 5000).
   * Frames are written to sessions/rolling/ and a telemetry event is emitted
   * for each frame so the HITL UI and external observers can track page state.
   * Safe to call multiple times — a running timer is stopped first.
   */
  startScreenshotTimer(intervalMs = 5000): void {
    this.stopScreenshotTimer();
    fs.mkdirSync(this._screenshotDir, { recursive: true });
    this._screenshotTimer = setInterval(async () => {
      if (!this._page || !this._started) return;
      try {
        const timestamp = Date.now();
        const url = this._page.url();
        const buf = await this._page.screenshot({ type: 'jpeg', quality: 70 });
        const filename = `frame-${timestamp}.jpg`;
        const filepath = path.join(this._screenshotDir, filename);
        fs.writeFileSync(filepath, buf);
        telemetry.emit({
          source: 'session',
          name: 'session.screenshot.rolling',
          details: { url, file: filepath, timestamp },
        });
      } catch { /* page may be navigating — skip frame */ }
    }, intervalMs);
  }

  /** Stop the rolling screenshot timer. */
  stopScreenshotTimer(): void {
    if (this._screenshotTimer) {
      clearInterval(this._screenshotTimer);
      this._screenshotTimer = null;
    }
  }

  /**
   * Extract all cookies from the current browser context.
   * Used to inject auth state into agent engines that spawn their own browser.
   */
  async extractCookies(): Promise<Array<{ name: string; value: string; domain: string; path: string }>> {
    if (!this._context) return [];
    return this._context.cookies();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _waitForCdp(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const http = await import('http');
    while (Date.now() < deadline) {
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.get(`http://127.0.0.1:${this.cdpPort}/json/version`, (res) => {
          resolve(res.statusCode === 200);
          res.resume();
        });
        req.on('error', () => resolve(false));
        req.setTimeout(500, () => { req.destroy(); resolve(false); });
      });
      if (ok) return;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`Chrome CDP on port ${this.cdpPort} did not respond within ${timeoutMs}ms`);
  }
}

/** Singleton used by all modules in the serve process. */
export const sessionManager = new SessionManager();
