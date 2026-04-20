import {
  BridgeExitEvent,
  bridgeLifecycleEvents,
  getLatestBridgeExitEvent,
  recordBridgeExitEvent,
  resetLatestBridgeExitEventForTest,
} from './python-bridge';

describe('python-bridge lifecycle events', () => {
  beforeEach(() => {
    resetLatestBridgeExitEventForTest();
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
});
