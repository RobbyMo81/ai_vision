jest.mock('../session/manager', () => ({
  sessionManager: {
    captureScreenshot: jest.fn(),
  },
}));

jest.mock('../workflow/engine', () => ({
  workflowEngine: {
    currentState: { id: 'sess-mcp', phase: 'running' },
  },
}));

import { sessionManager } from '../session/manager';
import { buildSessionStatusLines, captureBrowserScreenshotForMcp } from './server';

describe('buildSessionStatusLines', () => {
  it('includes bridge alert line for unexpected bridge disconnect', () => {
    const lines = buildSessionStatusLines({
      phase: 'running',
      currentUrl: 'https://x.com/home',
      browserStarted: true,
      uiPort: '3000',
      latestBridgeExit: {
        engineId: 'browser-use',
        code: 1,
        signal: null,
        unexpected: true,
      },
    });

    expect(lines.join('\n')).toContain('Bridge alert: browser-use disconnected unexpectedly (code=1, signal=null)');
  });

  it('omits bridge alert line when latest exit was expected', () => {
    const lines = buildSessionStatusLines({
      phase: 'running',
      currentUrl: 'https://x.com/home',
      browserStarted: true,
      uiPort: '3000',
      latestBridgeExit: {
        engineId: 'browser-use',
        code: 0,
        signal: 'SIGTERM',
        unexpected: false,
      },
    });

    expect(lines.join('\n')).not.toContain('Bridge alert:');
  });
});

describe('captureBrowserScreenshotForMcp', () => {
  it('returns structured blocked payload text when the shared screenshot gate denies pixels', async () => {
    (sessionManager.captureScreenshot as jest.Mock).mockResolvedValue({
      id: 'shot-mcp',
      source: 'mcp',
      class: 'sensitive_blocked',
      mimeType: 'image/jpeg',
      takenAt: new Date('2026-05-02T00:00:00.000Z').toISOString(),
      sessionId: 'sess-mcp',
      sensitivity: 'blocked',
      retention: 'ephemeral',
      persistBase64: false,
      blockedReason: 'pii_wait_active',
      nextAction: 'retry_after_sensitive_phase',
    });

    const result = await captureBrowserScreenshotForMcp();

    expect(sessionManager.captureScreenshot).toHaveBeenCalledWith(expect.objectContaining({
      source: 'mcp',
      accessPath: 'mcp',
    }));
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(String(result.content[0].text)).toContain('sensitive_blocked');
    expect(String(result.content[0].text)).toContain('retry_after_sensitive_phase');
  });
});
