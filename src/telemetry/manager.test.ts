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

  it('does not raise telemetry alerts for expected final confirmation rejections', () => {
    const manager = new TelemetryManager();
    const event = manager.emit({
      source: 'workflow',
      name: 'workflow.hitl_confirmation.rejected',
      level: 'error',
      workflowId: 'post_to_x',
      stepId: 'confirm_post_visible',
      details: {
        reason: 'Operator did not confirm the final visible state.',
      },
    });

    expect(event.issue).toBeUndefined();
    expect(manager.recentAlerts(20).some(alert => alert.id === event.id)).toBe(false);
  });

  it('does not alert on expected confirm-step workflow failures', () => {
    const manager = new TelemetryManager();
    const event = manager.emit({
      source: 'workflow',
      name: 'workflow.run.failed',
      level: 'error',
      workflowId: 'write_and_post_to_x',
      details: {
        error: "Step 'confirm_post_visible' failed: Operator did not confirm the final visible state.",
      },
    });

    expect(event.issue).toBeUndefined();
    expect(manager.recentAlerts(20).some(alert => alert.id === event.id)).toBe(false);
  });
});
