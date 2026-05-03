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
import { decideScreenshotPolicy, SensitiveScreenshotContext } from './screenshot-policy';
import { ScreenshotPayload, SessionState, ScreenshotSource } from './types';
import { SessionRepository } from '../db/repository';
import {
  deleteScreenshotFile,
  deleteEvidenceScreenshot,
  runStartupScreenshotScavenger,
} from './screenshot-retention';

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
  private readonly _stepScopedDir: string;
  private _lastSessionState: SessionState | null = null;
  private _sensitiveScreenshotContext: SensitiveScreenshotContext | null = null;
  private readonly _stepScopedFiles = new Map<string, Set<string>>();

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
    this._stepScopedDir = process.env.SESSION_DIR
      ? path.join(process.env.SESSION_DIR, 'step-scoped')
      : path.join(process.cwd(), 'sessions', 'step-scoped');
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
    setImmediate(() => {
      try {
        runStartupScreenshotScavenger({ limit: 100 });
      } catch (error) {
        telemetry.emit({
          source: 'session',
          name: 'session.screenshot.startup_scavenger_failed',
          level: 'warn',
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });
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
    this.clearStepScopedScreenshots();
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

  syncSessionState(state: SessionState | null): void {
    this._lastSessionState = state;
  }

  setSensitiveScreenshotContext(context: SensitiveScreenshotContext | null): void {
    this._sensitiveScreenshotContext = context;
  }

  captureState(): SessionState | null {
    return this._lastSessionState;
  }

  async captureScreenshot(request: {
    source: ScreenshotSource;
    accessPath: 'ui' | 'mcp' | 'workflow' | 'rolling';
    state?: SessionState | null;
    evidenceRequested?: boolean;
  }): Promise<ScreenshotPayload> {
    const state = request.state ?? this._lastSessionState;
    const decision = decideScreenshotPolicy({
      source: request.source,
      accessPath: request.accessPath,
      state,
      sensitiveContext: this._sensitiveScreenshotContext,
      evidenceRequested: request.evidenceRequested,
    });
    const page = await this.getPage();
    const url = await this.currentUrl().catch(() => page.url());
    const basePayload: ScreenshotPayload = {
      id: `${request.source}-${Date.now()}`,
      source: request.source,
      class: decision.class,
      mimeType: 'image/jpeg',
      takenAt: new Date().toISOString(),
      sessionId: state?.id,
      stepId: state?.currentStep,
      url,
      sensitivity: decision.sensitivity,
      retention: decision.retention,
      persistBase64: false,
      blockedReason: decision.blockedReason,
      nextAction: decision.nextAction,
      expiresOnStepAdvance: decision.expiresOnStepAdvance,
      redactionApplied: decision.redactionApplied,
      redactedSelectors: decision.redactSelectors,
    };

    if (!decision.allowed) {
      telemetry.emit({
        source: 'session',
        name: 'session.screenshot.blocked',
        level: 'warn',
        sessionId: state?.id,
        details: {
          accessPath: request.accessPath,
          class: decision.class,
          blockedReason: decision.blockedReason ?? '',
          nextAction: decision.nextAction ?? '',
          stepId: state?.currentStep ?? '',
          phase: state?.phase ?? 'idle',
          source: request.source,
        },
      });
      return basePayload;
    }

    const screenshotOptions: import('playwright-core').PageScreenshotOptions = {
      type: 'jpeg',
      quality: request.accessPath === 'rolling' ? 70 : 80,
    };

    if ((decision.redactSelectors ?? []).length > 0) {
      const maskLocators: Array<import('playwright-core').Locator> = [];
      for (const selector of decision.redactSelectors ?? []) {
        const locator = page.locator(selector);
        const count = await locator.count();
        if (count === 0) {
          telemetry.emit({
            source: 'session',
            name: 'session.screenshot.redaction_unavailable',
            level: 'warn',
            sessionId: state?.id,
            details: {
              accessPath: request.accessPath,
              selector,
              stepId: state?.currentStep ?? '',
              source: request.source,
            },
          });
          return {
            ...basePayload,
            class: 'sensitive_blocked',
            sensitivity: 'blocked',
            retention: 'ephemeral',
            blockedReason: 'redaction_unavailable',
            nextAction: 'complete_sensitive_step_via_hitl',
            expiresOnStepAdvance: undefined,
            redactionApplied: undefined,
            redactedSelectors: undefined,
          };
        }
        maskLocators.push(locator.first());
      }
      screenshotOptions.mask = maskLocators;
      screenshotOptions.maskColor = '#000000';
    }

    const buf = await page.screenshot(screenshotOptions);
    const payload: ScreenshotPayload = {
      ...basePayload,
      base64: buf.toString('base64'),
    };

    if (decision.expiresOnStepAdvance) {
      payload.path = this.writeStepScopedScreenshot(buf, state?.currentStep);
    }

    telemetry.emit({
      source: 'session',
      name: decision.redactionApplied ? 'session.screenshot.redacted' : 'session.screenshot.allowed',
      sessionId: state?.id,
      details: {
        accessPath: request.accessPath,
        class: decision.class,
        stepId: state?.currentStep ?? '',
        phase: state?.phase ?? 'idle',
        source: request.source,
        retention: decision.retention,
        redactionApplied: decision.redactionApplied === true,
        expiresOnStepAdvance: decision.expiresOnStepAdvance === true,
        path: payload.path ?? '',
      },
    });

    return payload;
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
        const payload = await this.captureScreenshot({
          source: 'rolling',
          accessPath: 'rolling',
        });
        if (!payload.base64) {
          return;
        }
        const url = payload.url ?? this._page.url();
        const buf = Buffer.from(payload.base64, 'base64');
        const filename = `frame-${timestamp}.jpg`;
        const filepath = payload.path && payload.class === 'step_scoped'
          ? payload.path
          : path.join(this._screenshotDir, filename);
        fs.writeFileSync(filepath, buf);
        telemetry.emit({
          source: 'session',
          name: 'session.screenshot.rolling',
          details: {
            url,
            file: filepath,
            timestamp,
            class: payload.class,
            retention: payload.retention,
          },
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

  handleStepAdvance(nextStepId?: string): void {
    const deletedFiles: string[] = [];
    const failedFiles: string[] = [];
    const repo = new SessionRepository();
    for (const [stepId, files] of this._stepScopedFiles.entries()) {
      if (stepId === nextStepId) continue;
      for (const file of files) {
        const deleted = deleteScreenshotFile({
          repo,
          screenshotPath: file,
          sessionId: this._lastSessionState?.id,
          workflowId: undefined,
          stepId,
          class: 'step_scoped',
          retention: 'step_scoped',
          action: 'step_advance_cleanup',
        });
        if (deleted) {
          deletedFiles.push(file);
        } else {
          failedFiles.push(file);
        }
      }
      this._stepScopedFiles.delete(stepId);
    }

    if (deletedFiles.length > 0 || failedFiles.length > 0) {
      telemetry.emit({
        source: 'session',
        name: 'session.screenshot.step_scoped_deleted',
        level: failedFiles.length > 0 ? 'warn' : 'info',
        details: {
          deletedCount: deletedFiles.length,
          failedCount: failedFiles.length,
          nextStepId: nextStepId ?? '',
          deletedFiles,
          failedFiles,
        },
      });
    }
  }

  clearStepScopedScreenshots(): void {
    this.handleStepAdvance(undefined);
  }

  deleteEvidenceScreenshot(input: {
    evidenceId: string;
    sessionId: string;
    workflowId?: string;
    stepId?: string;
    screenshotPath: string;
    contentHash?: string;
    actor?: string;
    reason?: string;
  }): { deleted: boolean; contentHash: string } {
    const result = deleteEvidenceScreenshot({
      repo: new SessionRepository(),
      evidenceId: input.evidenceId,
      sessionId: input.sessionId,
      workflowId: input.workflowId,
      stepId: input.stepId,
      screenshotPath: input.screenshotPath,
      contentHash: input.contentHash,
      actor: input.actor ?? 'ui',
      reason: input.reason ?? 'manual evidence deletion',
    });

    if (result.deleted) {
      this.emit('screenshot_deleted', {
        evidenceId: input.evidenceId,
        sessionId: input.sessionId,
        workflowId: input.workflowId,
        stepId: input.stepId,
        screenshotPath: input.screenshotPath,
      });
    }

    return result;
  }

  private writeStepScopedScreenshot(buf: Buffer, stepId?: string): string {
    fs.mkdirSync(this._stepScopedDir, { recursive: true });
    const resolvedStepId = stepId && stepId.length > 0 ? stepId : 'unknown-step';
    const filepath = path.join(this._stepScopedDir, `${resolvedStepId}-${Date.now()}.jpg`);
    fs.writeFileSync(filepath, buf);
    const files = this._stepScopedFiles.get(resolvedStepId) ?? new Set<string>();
    files.add(filepath);
    this._stepScopedFiles.set(resolvedStepId, files);
    return filepath;
  }
}

/** Singleton used by all modules in the serve process. */
export const sessionManager = new SessionManager();
