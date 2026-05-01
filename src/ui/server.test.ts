/**
 * US-024 regression tests — confirm-final-step pre-flight gates and
 * return-control attribution telemetry.
 *
 * Integration tests spin up a real HTTP server on an ephemeral port and hit
 * the endpoints directly with Node's built-in `http` module.  All external
 * dependencies are mocked so no browser / engine / DB is required.
 */

import * as http from 'http';

// ---------------------------------------------------------------------------
// Module mocks (must be declared before any import of the module under test)
// ---------------------------------------------------------------------------

// Provide a stub SessionState-like object on workflowEngine.currentState that
// individual tests can mutate between requests.
const mockCurrentState: Record<string, unknown> | null = null;
const mockEngine = { currentState: mockCurrentState as Record<string, unknown> | null };

jest.mock('../workflow/engine', () => ({ workflowEngine: mockEngine }));

const mockHitlCoordinator = {
  on: jest.fn(),
  emit: jest.fn(),
  returnControl: jest.fn(),
  confirmCompletion: jest.fn(),
  submitSensitiveValue: jest.fn(),
  requestTakeover: jest.fn(),
  requestSensitiveValue: jest.fn(),
  requestCompletionConfirmation: jest.fn(),
  setPhase: jest.fn(),
  syncPhase: jest.fn(),
  requestQaPause: jest.fn(),
};
jest.mock('../session/hitl', () => ({ hitlCoordinator: mockHitlCoordinator }));

const mockTelemetryEmit = jest.fn();
jest.mock('../telemetry', () => ({ telemetry: { emit: mockTelemetryEmit } }));

jest.mock('../session/manager', () => ({
  sessionManager: {
    isStarted: false,
    screenshot: jest.fn(),
    currentUrl: jest.fn().mockResolvedValue(''),
    on: jest.fn(),
  },
}));

jest.mock('../engines/python-bridge', () => ({
  bridgeLifecycleEvents: { on: jest.fn() },
  browserUseActionEvents: { on: jest.fn() },
  BridgeExitEvent: {},
  BrowserUseActionEvent: {},
}));

// Stub the ws WebSocketServer — HTTP-only tests do not need real WebSockets.
// clients must be an iterable Set with a `size` property for `connectionCount()`.
const mockWssClients = new Set<unknown>();
const mockWss = {
  clients: mockWssClients,
  on: jest.fn(),
  handleUpgrade: jest.fn(),
};
jest.mock('ws', () => ({
  WebSocketServer: jest.fn().mockImplementation(() => mockWss),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  port: number,
  path: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, 'utf8');
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': buf.length,
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode ?? 0, data: raw }); }
        });
      },
    );
    req.on('error', reject);
    req.end(buf);
  });
}

// ---------------------------------------------------------------------------
// POST /api/confirm-final-step  —  pre-flight gate tests
// ---------------------------------------------------------------------------

describe('POST /api/confirm-final-step — pre-flight gates', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { startUiServer } = await import('./server');
    server = await startUiServer(0);
    port = (server.address() as { port: number }).port;
  });

  afterAll((done) => {
    server.close(done);
    (console.error as jest.Mock).mockRestore?.();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockEngine.currentState = null;
  });

  // Gate 1 — run-phase gate
  it('returns 409 when no active final-confirmation is in progress (phase != hitl_qa)', async () => {
    mockEngine.currentState = { phase: 'running', id: 'sess-1' };
    const body = JSON.stringify({ confirmed: true });
    const result = await makeRequest(port, '/api/confirm-final-step', body);
    expect(result.status).toBe(409);
    expect((result.data as { error: string }).error).toMatch(/No active final confirmation/);
  });

  it('returns 409 when workflowEngine.currentState is null', async () => {
    mockEngine.currentState = null;
    const body = JSON.stringify({ confirmed: true });
    const result = await makeRequest(port, '/api/confirm-final-step', body);
    expect(result.status).toBe(409);
  });

  it('emits ui.hitl.confirm_final_step.rejected with gate=run_phase_gate on 409', async () => {
    mockEngine.currentState = { phase: 'idle', id: 'sess-x' };
    await makeRequest(port, '/api/confirm-final-step', JSON.stringify({ confirmed: true }));
    const rejCall = mockTelemetryEmit.mock.calls.find(
      ([e]) => e.name === 'ui.hitl.confirm_final_step.rejected',
    );
    expect(rejCall).toBeDefined();
    expect(rejCall[0].details.gate).toBe('run_phase_gate');
  });

  // Gate 2 — session-binding gate
  it('returns 400 when requestSessionId does not match the active session', async () => {
    mockEngine.currentState = { phase: 'hitl_qa', id: 'sess-A' };
    const body = JSON.stringify({ confirmed: true, sessionId: 'sess-B' });
    const result = await makeRequest(port, '/api/confirm-final-step', body);
    expect(result.status).toBe(400);
    expect((result.data as { error: string }).error).toMatch(/Session ID mismatch/);
  });

  it('emits ui.hitl.confirm_final_step.rejected with gate=session_binding_gate on 400', async () => {
    mockEngine.currentState = { phase: 'hitl_qa', id: 'sess-A' };
    await makeRequest(
      port,
      '/api/confirm-final-step',
      JSON.stringify({ confirmed: true, sessionId: 'sess-B' }),
    );
    const rejCall = mockTelemetryEmit.mock.calls.find(
      ([e]) => e.name === 'ui.hitl.confirm_final_step.rejected',
    );
    expect(rejCall).toBeDefined();
    expect(rejCall[0].details.gate).toBe('session_binding_gate');
  });

  // Gate 3 — WebSocket-presence gate
  it('returns 403 when resolvedClientId is set but has no matching WS connection', async () => {
    mockEngine.currentState = { phase: 'hitl_qa', id: 'sess-A' };
    const body = JSON.stringify({ confirmed: true, clientId: 'unknown-client-xyz' });
    const result = await makeRequest(port, '/api/confirm-final-step', body);
    expect(result.status).toBe(403);
    expect((result.data as { error: string }).error).toMatch(/No active UI session/);
  });

  it('emits ui.hitl.confirm_final_step.rejected with gate=websocket_presence_gate on 403', async () => {
    mockEngine.currentState = { phase: 'hitl_qa', id: 'sess-A' };
    await makeRequest(
      port,
      '/api/confirm-final-step',
      JSON.stringify({ confirmed: true, clientId: 'unknown-client-xyz' }),
    );
    const rejCall = mockTelemetryEmit.mock.calls.find(
      ([e]) => e.name === 'ui.hitl.confirm_final_step.rejected',
    );
    expect(rejCall).toBeDefined();
    expect(rejCall[0].details.gate).toBe('websocket_presence_gate');
  });

  // Happy path — all gates pass (no sessionId, no clientId supplied)
  it('returns 200 and calls confirmCompletion when all gates pass', async () => {
    mockEngine.currentState = { phase: 'hitl_qa', id: 'sess-A' };
    const body = JSON.stringify({ confirmed: true });
    const result = await makeRequest(port, '/api/confirm-final-step', body);
    expect(result.status).toBe(200);
    expect(mockHitlCoordinator.confirmCompletion).toHaveBeenCalledWith(true, '');
  });

  it('does NOT emit rejected event on happy-path 200', async () => {
    mockEngine.currentState = { phase: 'hitl_qa', id: 'sess-A' };
    await makeRequest(port, '/api/confirm-final-step', JSON.stringify({ confirmed: true }));
    const rejCall = mockTelemetryEmit.mock.calls.find(
      ([e]) => e.name === 'ui.hitl.confirm_final_step.rejected',
    );
    expect(rejCall).toBeUndefined();
  });

  it('session-binding gate passes when requestSessionId matches active session', async () => {
    mockEngine.currentState = { phase: 'hitl_qa', id: 'sess-A' };
    const body = JSON.stringify({ confirmed: true, sessionId: 'sess-A' });
    const result = await makeRequest(port, '/api/confirm-final-step', body);
    expect(result.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/return-control  —  pre-flight gates + attribution telemetry
// ---------------------------------------------------------------------------

describe('POST /api/return-control — pre-flight gates + attribution telemetry', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    // Each describe block gets its own server instance to avoid state leakage.
    const { startUiServer } = jest.requireActual('./server') as typeof import('./server');
    // jest.isolateModules would be cleanest, but we can reuse the already-mocked
    // module since all mocks are still registered.
    server = await startUiServer(0);
    port = (server.address() as { port: number }).port;
  });

  afterAll((done) => {
    server.close(done);
    (console.error as jest.Mock).mockRestore?.();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockEngine.currentState = { phase: 'idle', id: 'sess-rc', hitlAction: null, currentStep: 'step-a' };
  });

  it('returns 409 for invalid phase/action and emits return_control_action_gate rejection', async () => {
    const result = await makeRequest(port, '/api/return-control', '');
    expect(result.status).toBe(409);
    expect(mockHitlCoordinator.returnControl).not.toHaveBeenCalled();
    const rejCall = mockTelemetryEmit.mock.calls.find(
      ([e]) => e.name === 'ui.hitl.return_control.rejected',
    );
    expect(rejCall).toBeDefined();
    expect(rejCall[0].details.gate).toBe('return_control_action_gate');
  });

  it('returns 400 for session mismatch and emits session_binding_gate rejection', async () => {
    mockEngine.currentState = { phase: 'awaiting_human', id: 'sess-rc', hitlAction: 'return_control' };
    const result = await makeRequest(
      port,
      '/api/return-control',
      JSON.stringify({ sessionId: 'wrong-session' }),
    );
    expect(result.status).toBe(400);
    const rejCall = mockTelemetryEmit.mock.calls.find(
      ([e]) => e.name === 'ui.hitl.return_control.rejected',
    );
    expect(rejCall).toBeDefined();
    expect(rejCall[0].details.gate).toBe('session_binding_gate');
  });

  it('returns 403 for stale client and emits websocket_presence_gate rejection', async () => {
    mockEngine.currentState = { phase: 'awaiting_human', id: 'sess-rc', hitlAction: 'return_control' };
    const result = await makeRequest(
      port,
      '/api/return-control',
      JSON.stringify({ clientId: 'unknown-client-xyz' }),
    );
    expect(result.status).toBe(403);
    const rejCall = mockTelemetryEmit.mock.calls.find(
      ([e]) => e.name === 'ui.hitl.return_control.rejected',
    );
    expect(rejCall).toBeDefined();
    expect(rejCall[0].details.gate).toBe('websocket_presence_gate');
  });

  it('awaiting_human:return_control resumes successfully', async () => {
    mockEngine.currentState = { phase: 'awaiting_human', id: 'sess-rc', hitlAction: 'return_control' };
    const result = await makeRequest(port, '/api/return-control', JSON.stringify({ sessionId: 'sess-rc' }));
    expect(result.status).toBe(200);
    expect(mockHitlCoordinator.returnControl).toHaveBeenCalledTimes(1);
  });

  it('awaiting_human:verify_authentication resumes successfully', async () => {
    mockEngine.currentState = { phase: 'awaiting_human', id: 'sess-rc', hitlAction: 'verify_authentication' };
    const result = await makeRequest(port, '/api/return-control', JSON.stringify({ sessionId: 'sess-rc' }));
    expect(result.status).toBe(200);
    expect(mockHitlCoordinator.returnControl).toHaveBeenCalledTimes(1);
  });

  it('hitl_qa:approve_draft resumes successfully', async () => {
    mockEngine.currentState = { phase: 'hitl_qa', id: 'sess-rc', hitlAction: 'approve_draft' };
    const result = await makeRequest(port, '/api/return-control', JSON.stringify({ sessionId: 'sess-rc' }));
    expect(result.status).toBe(200);
    expect(mockHitlCoordinator.returnControl).toHaveBeenCalledTimes(1);
  });

  it('hitl_qa:capture_notes resumes successfully', async () => {
    mockEngine.currentState = { phase: 'hitl_qa', id: 'sess-rc', hitlAction: 'capture_notes' };
    const result = await makeRequest(port, '/api/return-control', JSON.stringify({ sessionId: 'sess-rc' }));
    expect(result.status).toBe(200);
    expect(mockHitlCoordinator.returnControl).toHaveBeenCalledTimes(1);
  });

  it('hitl_qa:approve_step resumes successfully', async () => {
    mockEngine.currentState = { phase: 'hitl_qa', id: 'sess-rc', hitlAction: 'approve_step' };
    const result = await makeRequest(port, '/api/return-control', JSON.stringify({ sessionId: 'sess-rc' }));
    expect(result.status).toBe(200);
    expect(mockHitlCoordinator.returnControl).toHaveBeenCalledTimes(1);
  });

  it('approval wait returns 400 for session mismatch and emits session_binding_gate rejection', async () => {
    mockEngine.currentState = { phase: 'hitl_qa', id: 'sess-rc', hitlAction: 'approve_step' };
    const result = await makeRequest(
      port,
      '/api/return-control',
      JSON.stringify({ sessionId: 'wrong-session' }),
    );
    expect(result.status).toBe(400);
    const rejCall = mockTelemetryEmit.mock.calls.find(
      ([e]) => e.name === 'ui.hitl.return_control.rejected',
    );
    expect(rejCall).toBeDefined();
    expect(rejCall[0].details.gate).toBe('session_binding_gate');
  });

  it('approval wait returns 403 for stale client and emits websocket_presence_gate rejection', async () => {
    mockEngine.currentState = { phase: 'hitl_qa', id: 'sess-rc', hitlAction: 'approve_step' };
    const result = await makeRequest(
      port,
      '/api/return-control',
      JSON.stringify({ sessionId: 'sess-rc', clientId: 'unknown-client-xyz' }),
    );
    expect(result.status).toBe(403);
    const rejCall = mockTelemetryEmit.mock.calls.find(
      ([e]) => e.name === 'ui.hitl.return_control.rejected',
    );
    expect(rejCall).toBeDefined();
    expect(rejCall[0].details.gate).toBe('websocket_presence_gate');
  });

  it('approval wait returns 409 for invalid phase/action and emits return_control_action_gate rejection', async () => {
    mockEngine.currentState = { phase: 'hitl_qa', id: 'sess-rc', hitlAction: 'confirm_completion' };
    const result = await makeRequest(
      port,
      '/api/return-control',
      JSON.stringify({ sessionId: 'sess-rc' }),
    );
    expect(result.status).toBe(409);
    const rejCall = mockTelemetryEmit.mock.calls.find(
      ([e]) => e.name === 'ui.hitl.return_control.rejected',
    );
    expect(rejCall).toBeDefined();
    expect(rejCall[0].details.gate).toBe('return_control_action_gate');
  });

  it('non-UI empty resolvedClientId behavior remains unchanged (not blocked in this story)', async () => {
    mockEngine.currentState = { phase: 'awaiting_human', id: 'sess-rc', hitlAction: 'return_control' };
    const result = await makeRequest(port, '/api/return-control', JSON.stringify({ sessionId: 'sess-rc' }));
    expect(result.status).toBe(200);
    expect(mockHitlCoordinator.returnControl).toHaveBeenCalledTimes(1);
  });

  it('emits ui.hitl.return_control.received with required attribution fields', async () => {
    mockEngine.currentState = { phase: 'awaiting_human', id: 'sess-rc', hitlAction: 'return_control' };
    await makeRequest(port, '/api/return-control', JSON.stringify({ sessionId: 'sess-rc' }));
    const emitCall = mockTelemetryEmit.mock.calls.find(
      ([e]) => e.name === 'ui.hitl.return_control.received',
    );
    expect(emitCall).toBeDefined();
    const details = emitCall[0].details as Record<string, unknown>;
    expect(details).toHaveProperty('resolvedClientId');
    expect(details).toHaveProperty('matchingWsClientIds');
    expect(details).toHaveProperty('matchingWsClientCount');
    expect(details).toHaveProperty('wsConnectionCount');
    expect(details).toHaveProperty('currentPhase');
    expect(details).toHaveProperty('currentHitlAction');
    expect(details).toHaveProperty('currentStep');
    expect(details).toHaveProperty('remoteAddress');
  });

  it('resolves clientId from X-AiVision-Client-Id header when body is empty', async () => {
    mockEngine.currentState = { phase: 'awaiting_human', id: 'sess-rc', hitlAction: 'return_control' };
    await makeRequest(port, '/api/return-control', '', {
      'X-AiVision-Client-Id': 'hdr-client-99',
    });
    const emitCall = mockTelemetryEmit.mock.calls.find(
      ([e]) => e.name === 'ui.hitl.return_control.received',
    );
    expect(emitCall).toBeDefined();
    expect(emitCall[0].details.resolvedClientId).toBe('hdr-client-99');
  });

  it('resolves clientId from JSON body when provided', async () => {
    mockEngine.currentState = { phase: 'awaiting_human', id: 'sess-rc', hitlAction: 'return_control' };
    await makeRequest(
      port,
      '/api/return-control',
      JSON.stringify({ clientId: 'body-client-42' }),
    );
    const emitCall = mockTelemetryEmit.mock.calls.find(
      ([e]) => e.name === 'ui.hitl.return_control.received',
    );
    expect(emitCall).toBeDefined();
    expect(emitCall[0].details.resolvedClientId).toBe('body-client-42');
  });

  it('emits ui.hitl.return_control.completed on successful resume', async () => {
    mockEngine.currentState = { phase: 'awaiting_human', id: 'sess-rc', hitlAction: 'return_control' };
    await makeRequest(
      port,
      '/api/return-control',
      JSON.stringify({ sessionId: 'sess-rc', requestId: 'req-1', clientId: '' }),
    );
    const completedCall = mockTelemetryEmit.mock.calls.find(
      ([e]) => e.name === 'ui.hitl.return_control.completed',
    );
    expect(completedCall).toBeDefined();
    expect(completedCall[0].details.requestId).toBe('req-1');
    expect(completedCall[0].details.requestSessionId).toBe('sess-rc');
  });
});
