import { AutomationEngine, EngineId } from './interface';
import { BrowserUseEngine } from './browser-use/engine';
import { SkyvernEngine } from './skyvern/engine';
import { StagehandEngine } from './stagehand/engine';

type EngineFactory = () => AutomationEngine;

const FACTORIES: Record<EngineId, EngineFactory> = {
  'browser-use': () => new BrowserUseEngine(),
  'skyvern': () => new SkyvernEngine(),
  'stagehand': () => new StagehandEngine(),
};

export class EngineRegistry {
  private engines = new Map<EngineId, AutomationEngine>();

  /** Get or create an engine instance. Does NOT call initialize(). */
  get(id: EngineId): AutomationEngine {
    if (!this.engines.has(id)) {
      const factory = FACTORIES[id];
      if (!factory) throw new Error(`Unknown engine: '${id}'`);
      this.engines.set(id, factory());
    }
    return this.engines.get(id)!;
  }

  /** Get a ready-to-use engine (calls initialize() if needed). */
  async getReady(id: EngineId): Promise<AutomationEngine> {
    const engine = this.get(id);
    if (!engine.ready) await engine.initialize();
    return engine;
  }

  /** Close and remove all initialized engines. */
  async closeAll(): Promise<void> {
    const closings = [...this.engines.values()]
      .filter((e) => e.ready)
      .map((e) => e.close().catch((err) => console.error(`Error closing ${e.id}:`, err)));
    await Promise.all(closings);
    this.engines.clear();
  }

  availableEngines(): EngineId[] {
    return Object.keys(FACTORIES) as EngineId[];
  }
}

export const registry = new EngineRegistry();
