import * as path from 'path';
import { PythonBridgeEngine } from '../python-bridge';

export class BrowserUseEngine extends PythonBridgeEngine {
  constructor() {
    super({
      engineId: 'browser-use',
      port: parseInt(process.env.BROWSER_USE_PORT ?? '8001', 10),
      serverScript: path.resolve(__dirname, 'server/main.py'),
    });
  }
}
