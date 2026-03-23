import * as path from 'path';
import { PythonBridgeEngine } from '../python-bridge';

export class SkyvernEngine extends PythonBridgeEngine {
  constructor() {
    super({
      engineId: 'skyvern',
      port: parseInt(process.env.SKYVERN_PORT ?? '8002', 10),
      serverScript: path.resolve(__dirname, 'server/main.py'),
    });
  }
}
