/**
 * Base class for TypeScript wrappers around Python FastAPI bridge servers.
 * Manages subprocess lifecycle and provides a typed HTTP client.
 */

import axios, { AxiosInstance } from 'axios';
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
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
      timeout: 120_000,
    });
  }

  get ready(): boolean {
    return this._ready;
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

  async navigate(url: string, _options?: NavigateOptions): Promise<void> {
    this._assertReady();
    try {
      await this._post('/navigate', { url });
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

  private _startSubprocess(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this.config.serverScript)) {
        reject(
          new AutomationError(
            `Bridge server script not found: ${this.config.serverScript}`,
            this.id
          )
        );
        return;
      }

      const proc = spawn('python3', [this.config.serverScript], {
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (d) => process.stdout.write(`[${this.id}] ${d}`));
      proc.stderr?.on('data', (d) => process.stderr.write(`[${this.id}] ${d}`));
      proc.on('error', (e) => reject(new AutomationError(`Failed to start bridge: ${e.message}`, this.id, e)));
      proc.on('exit', (code) => {
        if (this._ready) {
          // Unexpected exit after initialization
          console.error(`[${this.id}] bridge exited with code ${code}`);
          this._ready = false;
        }
      });

      this.process = proc;
      resolve();
    });
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
