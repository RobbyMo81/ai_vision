/**
 * Base class for TypeScript wrappers around Python FastAPI bridge servers.
 * Manages subprocess lifecycle and provides a typed HTTP client.
 */

import axios, { AxiosInstance } from 'axios';
import { ChildProcess, spawn, spawnSync } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import { telemetry } from '../telemetry';

// Resolve the project root (works from both src/ and dist/)
const PROJECT_ROOT = (() => {
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return __dirname;
})();

// Platform-aware path to the venv Python binary
const VENV_PYTHON = process.platform === 'win32'
  ? path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe')
  : path.join(PROJECT_ROOT, '.venv', 'bin', 'python3');

/**
 * Check whether a Python module is importable in the project venv (or system Python).
 * Used by engines that have optional Python package dependencies.
 */
export function checkPythonModule(moduleName: string): boolean {
  const pythonBin = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';
  const result = spawnSync(pythonBin, ['-c', `import ${moduleName}`], {
    timeout: 5_000,
    stdio: 'ignore',
  });
  return result.status === 0;
}
import {
  AutomationEngine,
  AutomationError,
  ClickOptions,
  EngineId,
  EngineNotReadyError,
  NavigateOptions,
  NavigationError,
  Screenshot,
  TaskResult,
  TypeOptions,
} from './interface';

interface BridgeConfig {
  engineId: EngineId;
  port: number;
  serverScript: string;
  startupTimeoutMs?: number;
}

export interface BridgeExitEvent {
  engineId: EngineId;
  code: number | null;
  signal: NodeJS.Signals | null;
  unexpected: boolean;
}

export interface BrowserUseActionEvent {
  engineId: 'browser-use';
  name: string;
  sessionId?: string;
  workflowId?: string;
  stepId?: string;
  browserUseStepId: string;
  browserUseStepNumber: number;
  action: string;
  actionNames: string[];
  actions: Array<{ name: string; params: Record<string, unknown> }>;
  selector?: string;
  url?: string;
  title?: string;
  screenshotBase64?: string;
  screenshotMimeType?: 'image/jpeg' | 'image/png';
  evaluationPreviousGoal?: string;
  memory?: string;
  nextGoal?: string;
  timestamp: string;
}

interface BrowserUseActionEventInput {
  session_id?: string;
  workflow_id?: string;
  step_id?: string;
  browser_use_step_id?: string;
  browser_use_step_number?: number;
  action?: string;
  selector?: string;
  url?: string;
  title?: string;
  screenshot_b64?: string;
  timestamp?: string;
  evaluation_previous_goal?: string;
  memory?: string;
  next_goal?: string;
  actions?: Array<{ name?: string; params?: Record<string, unknown> }>;
}

/**
 * Process-level lifecycle events for Python bridges.
 * Consumers (UI/MCP) can subscribe to propagate bridge failures immediately.
 */
export const bridgeLifecycleEvents = new EventEmitter();
export const browserUseActionEvents = new EventEmitter();
let latestBridgeExitEvent: BridgeExitEvent | null = null;
let browserUseCallbackServerPromise: Promise<string> | null = null;

export function getLatestBridgeExitEvent(): BridgeExitEvent | null {
  return latestBridgeExitEvent;
}

export function recordBridgeExitEvent(event: BridgeExitEvent): void {
  latestBridgeExitEvent = event;
  bridgeLifecycleEvents.emit('bridge_exit', event);
}

export function resetLatestBridgeExitEventForTest(): void {
  latestBridgeExitEvent = null;
}

function inferImageMimeType(base64?: string): 'image/jpeg' | 'image/png' | undefined {
  if (!base64) return undefined;
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
  return undefined;
}

export function normalizeBrowserUseActionEvent(
  input: BrowserUseActionEventInput,
): BrowserUseActionEvent {
  const actions = (input.actions ?? []).map((action) => ({
    name: String(action.name ?? 'unknown'),
    params: action.params ?? {},
  }));
  const actionNames = actions.length > 0
    ? actions.map((action) => action.name)
    : [String(input.action ?? 'step')];
  const primaryAction = String(input.action ?? actionNames[0] ?? 'step');
  const browserUseStepNumber = input.browser_use_step_number ?? 0;

  return {
    engineId: 'browser-use',
    name: `browser_use.action.${primaryAction}`,
    sessionId: input.session_id,
    workflowId: input.workflow_id,
    stepId: input.step_id,
    browserUseStepId: input.browser_use_step_id ?? `browser-use-step-${browserUseStepNumber}`,
    browserUseStepNumber,
    action: primaryAction,
    actionNames,
    actions,
    selector: input.selector,
    url: input.url,
    title: input.title,
    screenshotBase64: input.screenshot_b64,
    screenshotMimeType: inferImageMimeType(input.screenshot_b64),
    evaluationPreviousGoal: input.evaluation_previous_goal,
    memory: input.memory,
    nextGoal: input.next_goal,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

export function recordBrowserUseActionEvent(event: BrowserUseActionEvent): void {
  telemetry.emit({
    source: 'engine',
    name: event.name,
    sessionId: event.sessionId,
    workflowId: event.workflowId,
    stepId: event.stepId,
    details: {
      action: event.action,
      actionNames: event.actionNames,
      browserUseStepId: event.browserUseStepId,
      browserUseStepNumber: event.browserUseStepNumber,
      selector: event.selector,
      url: event.url,
      title: event.title,
      evaluationPreviousGoal: event.evaluationPreviousGoal,
      memory: event.memory,
      nextGoal: event.nextGoal,
      screenshotIncluded: Boolean(event.screenshotBase64),
      screenshotMimeType: event.screenshotMimeType,
    },
  });
  browserUseActionEvents.emit('browser_use_action', event);
}

export async function ensureBrowserUseCallbackServer(): Promise<string> {
  if (browserUseCallbackServerPromise) return browserUseCallbackServerPromise;

  browserUseCallbackServerPromise = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/browser-use-events') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}') as BrowserUseActionEventInput;
          recordBrowserUseActionEvent(normalizeBrowserUseActionEvent(payload));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      });
    });

    server.on('error', (error) => {
      browserUseCallbackServerPromise = null;
      reject(error);
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        browserUseCallbackServerPromise = null;
        reject(new Error('Could not resolve browser-use callback server address'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}/browser-use-events`);
    });
  });

  return browserUseCallbackServerPromise;
}

export abstract class PythonBridgeEngine implements AutomationEngine {
  readonly id: EngineId;
  private _ready = false;
  private process: ChildProcess | null = null;
  private http: AxiosInstance;
  private readonly config: Required<BridgeConfig>;

  constructor(config: BridgeConfig) {
    this.id = config.engineId;
    this.config = { startupTimeoutMs: 30_000, ...config };
    this.http = axios.create({
      baseURL: `http://127.0.0.1:${config.port}`,
      timeout: 1_800_000, // 30 min — complex form-filling tasks can take a while
    });
  }

  get ready(): boolean {
    return this._ready;
  }

  /** Default: all bridge engines are considered available unless overridden. */
  async available(): Promise<boolean> {
    return true;
  }

  async initialize(): Promise<void> {
    if (this._ready) return;
    const portFree = await this._checkPortFree();
    if (!portFree) {
      // Port occupied — try to reclaim it via graceful shutdown first.
      // If the orphaned server won't close, check if it's still healthy enough to reuse.
      const recovered = await this._recoverOccupiedPort();
      if (!recovered) {
        // Can't free the port; check if the existing server is healthy and reuse it.
        try {
          await this.http.get('/health');
          // Server is alive — adopt it without spawning a new process.
          await this._post('/initialize');
          this._ready = true;
          return;
        } catch {
          throw new AutomationError(
            `Port ${this.config.port} is already in use and the existing server is unhealthy. ` +
            `Kill the old '${this.id}' bridge process manually and retry.`,
            this.id
          );
        }
      }
    } else {
      await this._startSubprocess();
    }
    await this._waitForHealth();
    await this._post('/initialize');
    this._ready = true;
  }

  async close(): Promise<void> {
    if (!this._ready) return;
    try {
      await this._post('/close');
    } catch {
      // best-effort
    }
    this._ready = false;
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  async navigate(url: string, options?: NavigateOptions): Promise<void> {
    this._assertReady();
    try {
      await this._post('/navigate', { url, wait_until: options?.waitUntil ?? 'load' });
    } catch (e) {
      throw new NavigationError(this.id, url, e);
    }
  }

  async click(selector: string, options?: ClickOptions): Promise<void> {
    this._assertReady();
    await this._post('/click', { selector, description: options?.description });
  }

  async type(selector: string, text: string, options?: TypeOptions): Promise<void> {
    this._assertReady();
    await this._post('/type', {
      selector,
      text,
      description: options?.description,
      clear_first: options?.clearFirst ?? false,
    });
  }

  async screenshot(outputPath?: string): Promise<Screenshot> {
    this._assertReady();
    const res = await this._post<{
      path: string;
      base64: string;
      taken_at: string;
    }>('/screenshot', { output_path: outputPath ?? null });
    return {
      path: res.path,
      base64: res.base64,
      takenAt: new Date(res.taken_at),
    };
  }

  async runTask(prompt: string, context?: import('./interface').TaskContext): Promise<TaskResult> {
    this._assertReady();
    const res = await this._post<{
      success: boolean;
      output?: string;
      error?: string;
      screenshots: Array<{ path: string; base64: string; taken_at: string }>;
      duration_ms: number;
    }>('/task', {
      prompt,
      ...(context?.maxSteps != null ? { max_steps: context.maxSteps } : {}),
      ...(context?.sessionId ? { session_id: context.sessionId } : {}),
      ...(context?.workflowId ? { workflow_id: context.workflowId } : {}),
      ...(context?.stepId ? { step_id: context.stepId } : {}),
    });
    return {
      success: res.success,
      output: res.output,
      error: res.error,
      screenshots: res.screenshots.map((s) => ({
        path: s.path,
        base64: s.base64,
        takenAt: new Date(s.taken_at),
      })),
      durationMs: res.duration_ms,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _assertReady(): void {
    if (!this._ready) throw new EngineNotReadyError(this.id);
  }

  private async _post<T = unknown>(endpoint: string, body?: unknown): Promise<T> {
    try {
      const res = await this.http.post<T>(endpoint, body ?? {});
      return res.data;
    } catch (e) {
      throw new AutomationError(
        `Bridge request to ${endpoint} failed`,
        this.id,
        e
      );
    }
  }

  /** FIX-12: Check if a TCP port is already in use before spawning. */
  private _checkPortFree(): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = net.createConnection({ host: '127.0.0.1', port: this.config.port });
      probe.once('connect', () => { probe.destroy(); resolve(false); }); // port occupied
      probe.once('error', () => resolve(true));                          // port free
    });
  }

  /**
   * Recover from an orphaned bridge that still owns the configured port.
   * If the process responds to our health endpoint, ask it to shut down
   * cleanly before spawning a replacement.
   */
  private async _recoverOccupiedPort(): Promise<boolean> {
    const probe = axios.create({
      baseURL: `http://127.0.0.1:${this.config.port}`,
      timeout: 1_000,
      validateStatus: () => true,
    });

    try {
      const health = await probe.get('/health');
      if (health.status !== 200) return false;
    } catch {
      return false;
    }

    try {
      await probe.post('/close');
    } catch {
      return false;
    }

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await this._checkPortFree()) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return false;
  }

  private async _startSubprocess(): Promise<void> {
    if (!fs.existsSync(this.config.serverScript)) {
      throw new AutomationError(
        `Bridge server script not found: ${this.config.serverScript}`,
        this.id
      );
    }

    const pythonBin = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';

    // If a shared Chrome session is running (ai-vision serve), pass its CDP URL
    // so the Python bridge attaches to the same browser instead of spawning a new one.
    // This preserves cookies and auth state across HITL handoffs.
    // BROWSER_CDP_URL is set in process.env by the serve command before any engines are started.
    const cdpUrl = process.env.BROWSER_CDP_URL ?? '';
    const browserUseCallbackUrl = this.id === 'browser-use'
      ? await ensureBrowserUseCallbackServer()
      : '';

    const proc = spawn(pythonBin, [this.config.serverScript], {
      env: {
        ...process.env,
        ...(cdpUrl ? { BROWSER_CDP_URL: cdpUrl } : {}),
        ...(browserUseCallbackUrl ? { BROWSER_USE_CALLBACK_URL: browserUseCallbackUrl } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (d) => process.stdout.write(`[${this.id}] ${d}`));
    proc.stderr?.on('data', (d) => process.stderr.write(`[${this.id}] ${d}`));
    proc.on('error', (e) => {
      throw new AutomationError(`Failed to start bridge: ${e.message}`, this.id, e);
    });
    proc.on('exit', (code, signal) => {
      const unexpected = this._ready;
      const event: BridgeExitEvent = {
        engineId: this.id,
        code: code ?? null,
        signal: signal ?? null,
        unexpected,
      };
      recordBridgeExitEvent(event);
      if (unexpected) {
        // Unexpected exit after initialization
        console.error(`[${this.id}] bridge exited with code ${code}`);
        this._ready = false;
      }
    });

    this.process = proc;
  }

  private async _waitForHealth(): Promise<void> {
    const deadline = Date.now() + this.config.startupTimeoutMs;
    while (Date.now() < deadline) {
      try {
        await this.http.get('/health');
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new AutomationError(
      `Engine '${this.id}' did not become healthy within ${this.config.startupTimeoutMs}ms`,
      this.id
    );
  }
}
