/**
 * Base class for TypeScript wrappers around Python FastAPI bridge servers.
 * Manages subprocess lifecycle and provides a typed HTTP client.
 */

import axios, { AxiosInstance } from 'axios';
import { ChildProcess, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

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
      timeout: 600_000, // 10 min — agent tasks can be long-running
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
    await this._startSubprocess();
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

  async runTask(prompt: string): Promise<TaskResult> {
    this._assertReady();
    const res = await this._post<{
      success: boolean;
      output?: string;
      error?: string;
      screenshots: Array<{ path: string; base64: string; taken_at: string }>;
      duration_ms: number;
    }>('/task', { prompt });
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

  private async _startSubprocess(): Promise<void> {
    // FIX-12: Fail fast with a clear message instead of silently timing out
    const portFree = await this._checkPortFree();
    if (!portFree) {
      throw new AutomationError(
        `Port ${this.config.port} is already in use. ` +
        `A previous '${this.id}' bridge may still be running, or another process holds this port.`,
        this.id
      );
    }

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

    const proc = spawn(pythonBin, [this.config.serverScript], {
      env: { ...process.env, ...(cdpUrl ? { BROWSER_CDP_URL: cdpUrl } : {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (d) => process.stdout.write(`[${this.id}] ${d}`));
    proc.stderr?.on('data', (d) => process.stderr.write(`[${this.id}] ${d}`));
    proc.on('error', (e) => {
      throw new AutomationError(`Failed to start bridge: ${e.message}`, this.id, e);
    });
    proc.on('exit', (code) => {
      if (this._ready) {
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
