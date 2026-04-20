import { buildSessionStatusLines } from './server';

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
