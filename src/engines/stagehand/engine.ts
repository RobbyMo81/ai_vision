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
} from '../interface';

export class StagehandEngine implements AutomationEngine {
  readonly id: EngineId = 'stagehand';
  private _ready = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private stagehand: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private page: any = null;
  private readonly sessionDir: string;

  constructor() {
    this.sessionDir = process.env.SESSION_DIR ?? './sessions';
  }

  get ready(): boolean {
    return this._ready;
  }

  async available(): Promise<boolean> {
    return true;
  }

  async initialize(): Promise<void> {
    if (this._ready) return;
    const { Stagehand, AvailableModelSchema } = await import('@browserbasehq/stagehand');
    type AvailableModel = import('@browserbasehq/stagehand').AvailableModel;
    const provider = (process.env.STAGEHAND_LLM_PROVIDER ?? 'anthropic') as 'openai' | 'anthropic';
    const rawModel = process.env.STAGEHAND_LLM_MODEL ?? 'claude-sonnet-4-6';

    // FIX-14: Validate model name against Stagehand's schema at init time
    // to surface config errors before the browser is launched.
    const parsed = AvailableModelSchema.safeParse(rawModel);
    if (!parsed.success) {
      throw new AutomationError(
        `Invalid model '${rawModel}' for Stagehand. ` +
        `Check STAGEHAND_LLM_MODEL in .env. Run 'node dist/cli/index.js config' to reconfigure.`,
        this.id
      );
    }
    const model = parsed.data as AvailableModel;

    this.stagehand = new Stagehand({
      env: 'LOCAL',
      modelName: model,
      modelClientOptions: {
        apiKey: provider === 'anthropic'
          ? process.env.ANTHROPIC_API_KEY
          : process.env.OPENAI_API_KEY,
      },
    });

    await this.stagehand.init();
    this.page = this.stagehand.page;
    this._ready = true;
    fs.mkdirSync(this.sessionDir, { recursive: true });
  }

  async close(): Promise<void> {
    if (!this._ready) return;
    try {
      await this.stagehand.close();
    } finally {
      this._ready = false;
      this.stagehand = null;
      this.page = null;
    }
  }

  async navigate(url: string, options?: NavigateOptions): Promise<void> {
    this._assertReady();
    try {
      await this.page.goto(url, {
        waitUntil: options?.waitUntil ?? 'load',
      });
    } catch (e) {
      throw new NavigationError(this.id, url, e);
    }
  }

  async click(selector: string, options?: ClickOptions): Promise<void> {
    this._assertReady();
    try {
      if (options?.description) {
        // Use Stagehand AI-powered act for natural language targets
        await this.page.act({ action: `click ${options.description}` });
      } else {
        await this.page.click(selector);
      }
    } catch (e) {
      throw new AutomationError(`Click failed on '${selector}'`, this.id, e);
    }
  }

  async type(selector: string, text: string, options?: TypeOptions): Promise<void> {
    this._assertReady();
    try {
      if (options?.description) {
        await this.page.act({
          action: `type "${text}" into ${options.description}`,
        });
      } else {
        if (options?.clearFirst) {
          await this.page.fill(selector, '');
        }
        await this.page.type(selector, text);
      }
    } catch (e) {
      throw new AutomationError(`Type failed on '${selector}'`, this.id, e);
    }
  }

  async screenshot(outputPath?: string): Promise<Screenshot> {
    this._assertReady();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + 'Z';
    const filePath = outputPath ?? path.join(this.sessionDir, `stagehand-${timestamp}.png`);
    await this.page.screenshot({ path: filePath });
    return {
      path: filePath,
      takenAt: new Date(),
    };
  }

  /**
   * AI-powered structured extraction using Stagehand page.extract().
   * Called by the workflow engine for 'extract' and 'conditional' steps.
   */
  async extractText(instruction: string): Promise<string> {
    this._assertReady();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (this.page as any).extract({ instruction });
      if (typeof result === 'string') return result;
      return JSON.stringify(result);
    } catch (e) {
      throw new AutomationError(`Extract failed: ${instruction}`, this.id, e);
    }
  }

  async runTask(prompt: string): Promise<TaskResult> {
    this._assertReady();
    const start = Date.now();
    const screenshots: Screenshot[] = [];
    try {
      // Extract the first URL from the prompt and navigate to it first.
      // Stagehand's page.act() operates on the current page, so we need
      // to be somewhere meaningful before issuing the action instruction.
      const urlMatch = prompt.match(/https?:\/\/[^\s,)>]+/);
      if (urlMatch) {
        await this.page.goto(urlMatch[0], { waitUntil: 'domcontentloaded' });
      }

      // page.act() is the correct Stagehand v1.x API for natural-language
      // browser actions. stagehand.agent() does not exist in this version.
      await this.page.act({ action: prompt });

      const shot = await this.screenshot();
      screenshots.push(shot);
      return {
        success: true,
        output: `Task completed: ${prompt}`,
        screenshots,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        screenshots,
        durationMs: Date.now() - start,
      };
    }
  }

  private _assertReady(): void {
    if (!this._ready) throw new EngineNotReadyError(this.id);
  }
}
