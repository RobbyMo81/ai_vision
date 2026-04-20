import * as path from 'path';
import { checkPythonModule, PythonBridgeEngine } from '../python-bridge';
import { AutomationError } from '../interface';

export class SkyvernEngine extends PythonBridgeEngine {
  constructor() {
    super({
      engineId: 'skyvern',
      port: parseInt(process.env.SKYVERN_PORT ?? '8002', 10),
      serverScript: path.resolve(__dirname, 'server/main.py'),
    });
  }

  /** Skyvern requires the optional `skyvern` Python package. */
  async available(): Promise<boolean> {
    return checkPythonModule('skyvern');
  }

  async initialize(): Promise<void> {
    if (!(await this.available())) {
      throw new AutomationError(
        "Skyvern Python package is not installed. Run: .venv/bin/pip install skyvern",
        'skyvern'
      );
    }
    return super.initialize();
  }
}
