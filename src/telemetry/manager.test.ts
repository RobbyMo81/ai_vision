import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TelemetryManager } from './manager';

describe('TelemetryManager', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-vision-telemetry-'));
  const previousMemoryDir = process.env.AI_VISION_MEMORY_DIR;
  const previousDbPath = process.env.DB_PATH;

  beforeAll(() => {
    process.env.AI_VISION_MEMORY_DIR = path.join(tmpRoot, 'memory');
    process.env.DB_PATH = path.join(tmpRoot, 'telemetry.sqlite');
  });

  afterAll(() => {
    process.env.AI_VISION_MEMORY_DIR = previousMemoryDir;
    process.env.DB_PATH = previousDbPath;
  });

  it('redacts sensitive detail keys and detects long HITL waits', () => {
    const manager = new TelemetryManager();
    const event = manager.emit({
      source: 'hitl',
      name: 'hitl.wait.completed',
      durationMs: 180_000,
      details: {
        fieldValue: 'super-secret',
        label: 'DOB',
      },
    });

    expect(event.details.fieldValue).toBe('[REDACTED]');
    expect(event.issue?.code).toBe('hitl-wait-long');
    expect(manager.recentAlerts(5).some(alert => alert.id === event.id)).toBe(true);
  });
});
