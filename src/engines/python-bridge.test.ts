import {
  BrowserUseActionEvent,
  BridgeExitEvent,
  browserUseActionEvents,
  bridgeLifecycleEvents,
  getLatestBridgeExitEvent,
  normalizeBrowserUseActionEvent,
  recordBrowserUseActionEvent,
  recordBridgeExitEvent,
  resetLatestBridgeExitEventForTest,
} from './python-bridge';

jest.mock('../telemetry', () => ({
  telemetry: { emit: jest.fn() },
}));

const { telemetry } = require('../telemetry') as { telemetry: { emit: jest.Mock } };

describe('python-bridge lifecycle events', () => {
  beforeEach(() => {
    resetLatestBridgeExitEventForTest();
    telemetry.emit.mockClear();
  });

  it('records and emits unexpected bridge exits', () => {
    const captured: BridgeExitEvent[] = [];
    const handler = (event: BridgeExitEvent) => captured.push(event);
    bridgeLifecycleEvents.on('bridge_exit', handler);

    const event: BridgeExitEvent = {
      engineId: 'browser-use',
      code: 1,
      signal: null,
      unexpected: true,
    };

    recordBridgeExitEvent(event);

    expect(getLatestBridgeExitEvent()).toEqual(event);
    expect(captured).toEqual([event]);

    bridgeLifecycleEvents.off('bridge_exit', handler);
  });

  it('records expected bridge exits without flagging unexpected', () => {
    const event: BridgeExitEvent = {
      engineId: 'browser-use',
      code: 0,
      signal: 'SIGTERM',
      unexpected: false,
    };

    recordBridgeExitEvent(event);

    expect(getLatestBridgeExitEvent()).toEqual(event);
    expect(getLatestBridgeExitEvent()?.unexpected).toBe(false);
  });

  it('normalizes and emits browser-use action events', () => {
    const captured: BrowserUseActionEvent[] = [];
    const handler = (event: BrowserUseActionEvent) => captured.push(event);
    browserUseActionEvents.on('browser_use_action', handler);

    const event = normalizeBrowserUseActionEvent({
      session_id: 'sess-123',
      workflow_id: 'wf-123',
      step_id: 'publish_post',
      browser_use_step_number: 2,
      action: 'click',
      url: 'https://example.com/post',
      actions: [{ name: 'click', params: { index: 4 } }],
    });

    recordBrowserUseActionEvent(event);

    expect(telemetry.emit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'browser_use.action.click',
      source: 'engine',
      sessionId: 'sess-123',
      workflowId: 'wf-123',
      stepId: 'publish_post',
    }));
    expect(captured).toEqual([expect.objectContaining({
      action: 'click',
      browserUseStepId: 'browser-use-step-2',
      url: 'https://example.com/post',
    })]);

    browserUseActionEvents.off('browser_use_action', handler);
  });

  it('infers browser-use action screenshot MIME type from base64 payload', () => {
    const pngEvent = normalizeBrowserUseActionEvent({
      action: 'screenshot',
      screenshot_b64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
    });
    const jpegEvent = normalizeBrowserUseActionEvent({
      action: 'screenshot',
      screenshot_b64: '/9j/4AAQSkZJRgABAQAAAQABAAD',
    });

    expect(pngEvent.screenshotMimeType).toBe('image/png');
    expect(jpegEvent.screenshotMimeType).toBe('image/jpeg');
  });
});
