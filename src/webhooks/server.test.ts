import * as http from 'http';
import * as crypto from 'crypto';
import axios from 'axios';
import { startWebhookServer, verifySignature, signBody, TriggerPayload } from './server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  port: number,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, 'utf8');
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/webhooks/trigger',
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
// verifySignature unit tests
// ---------------------------------------------------------------------------

describe('verifySignature', () => {
  const secret = 'test-secret';

  it('accepts a valid sha256 signature', () => {
    const body = '{"workflow_id":"test"}';
    const sig = signBody(body, secret);
    expect(verifySignature(body, sig, secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = '{"workflow_id":"test"}';
    const sig = signBody(body, secret);
    expect(verifySignature('{"workflow_id":"other"}', sig, secret)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const body = '{"workflow_id":"test"}';
    const sig = signBody(body, secret);
    expect(verifySignature(body, sig, 'wrong-secret')).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(verifySignature('body', undefined, secret)).toBe(false);
  });

  it('rejects a malformed signature (no sha256= prefix)', () => {
    expect(verifySignature('body', 'abc123', secret)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HTTP endpoint integration tests
// ---------------------------------------------------------------------------

describe('POST /webhooks/trigger', () => {
  let server: http.Server;
  let port: number;
  const secret = 'integration-secret';

  beforeAll(async () => {
    process.env.WEBHOOK_SECRET = secret;
    // Use an ephemeral port
    server = await startWebhookServer(0);
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => {
    delete process.env.WEBHOOK_SECRET;
    server.close();
  });

  it('returns 401 for a missing signature when WEBHOOK_SECRET is set', async () => {
    const body = JSON.stringify({ workflow_id: 'nonexistent' });
    const result = await makeRequest(port, body);
    expect(result.status).toBe(401);
    expect((result.data as { ok: boolean }).ok).toBe(false);
  });

  it('returns 401 for an invalid signature', async () => {
    const body = JSON.stringify({ workflow_id: 'nonexistent' });
    const result = await makeRequest(port, body, { 'x-webhook-signature': 'sha256=badhash' });
    expect(result.status).toBe(401);
  });

  it('returns 404 for an unknown workflow_id with valid signature', async () => {
    const body = JSON.stringify({ workflow_id: 'does_not_exist' });
    const sig = signBody(body, secret);
    const result = await makeRequest(port, body, { 'x-webhook-signature': sig });
    expect(result.status).toBe(404);
    expect((result.data as { ok: boolean }).ok).toBe(false);
  });

  it('returns 400 for a malformed JSON body', async () => {
    const body = 'not-json';
    const sig = signBody(body, secret);
    const result = await makeRequest(port, body, { 'x-webhook-signature': sig });
    expect(result.status).toBe(400);
  });

  it('returns 400 for a missing workflow_id field', async () => {
    const body = JSON.stringify({ params: {} });
    const sig = signBody(body, secret);
    const result = await makeRequest(port, body, { 'x-webhook-signature': sig });
    expect(result.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// No-secret mode (dev)
// ---------------------------------------------------------------------------

describe('POST /webhooks/trigger — no WEBHOOK_SECRET', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    delete process.env.WEBHOOK_SECRET;
    server = await startWebhookServer(0);
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => { server.close(); });

  it('skips signature check and returns 404 for unknown workflow', async () => {
    const body = JSON.stringify({ workflow_id: 'nonexistent' });
    // No signature header — should not return 401
    const result = await makeRequest(port, body);
    expect(result.status).toBe(404);
  });
});
