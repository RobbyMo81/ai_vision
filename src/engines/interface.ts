export type EngineId = 'browser-use' | 'stagehand' | 'skyvern';

export interface NavigateOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface ClickOptions {
  /** Natural language description of the element, used by vision engines */
  description?: string;
}

export interface TypeOptions {
  /** Natural language description of the element, used by vision engines */
  description?: string;
  clearFirst?: boolean;
}

export interface Screenshot {
  path: string;
  base64?: string;
  takenAt: Date;
}

export interface TaskResult {
  success: boolean;
  output?: string;
  screenshots: Screenshot[];
  error?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AutomationError extends Error {
  constructor(
    message: string,
    public readonly engine: EngineId,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'AutomationError';
  }
}

export class EngineNotReadyError extends AutomationError {
  constructor(engine: EngineId) {
    super(`Engine '${engine}' is not initialized`, engine);
    this.name = 'EngineNotReadyError';
  }
}

export class NavigationError extends AutomationError {
  constructor(engine: EngineId, url: string, cause?: unknown) {
    super(`Navigation to '${url}' failed`, engine, cause);
    this.name = 'NavigationError';
  }
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface AutomationEngine {
  readonly id: EngineId;

  /** Start the engine (launch browser, warm up subprocess, etc.) */
  initialize(): Promise<void>;

  /** Release all resources */
  close(): Promise<void>;

  navigate(url: string, options?: NavigateOptions): Promise<void>;
  click(selector: string, options?: ClickOptions): Promise<void>;
  type(selector: string, text: string, options?: TypeOptions): Promise<void>;
  screenshot(outputPath?: string): Promise<Screenshot>;

  /** Run a free-form natural language task end-to-end */
  runTask(prompt: string): Promise<TaskResult>;

  /** True after initialize() has been called and before close() */
  readonly ready: boolean;
}
