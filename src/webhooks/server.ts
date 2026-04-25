/**
 * Webhook server — inbound triggers and outbound notifications.
 *
 * Endpoints:
 *   POST /webhooks/trigger — Accept {workflow_id, params, callback_url?},
 *                            validate HMAC-SHA256 signature, run workflow
 *                            asynchronously, and POST result to callback_url.
 *
 * Signature validation:
 *   Caller sets X-Webhook-Signature: sha256=<hmac-sha256-hex> where the HMAC
 *   is computed over the raw request body using WEBHOOK_SECRET.
 *   When WEBHOOK_SECRET is unset the signature check is skipped (dev mode).
 *
 * Secret management:
 *   WEBHOOK_SECRET must be loaded via `npm run vault:export` — never committed
 *   to plaintext env files.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as url from 'url';
import axios from 'axios';
import { z } from 'zod';
import { workflowEngine } from '../workflow/engine';
import { BUILTIN_WORKFLOWS } from '../workflow/types';
import { telemetry } from '../telemetry';

// ---------------------------------------------------------------------------
// Schemas & types
// ---------------------------------------------------------------------------

export const TriggerPayloadSchema = z.object({
  workflow_id: z.string(),
  params: z.record(z.unknown()).optional().default({}),
  callback_url: z.string().url().optional(),
});

export interface TriggerPayload {
  workflow_id: string;
  params: Record<string, unknown>;
  callback_url?: string;
}

export interface OutboundNotification {
  workflow_id: string;
  success: boolean;
  outputs: Record<string, string>;
  durationMs: number;
  timestamp: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Signature helpers (exported for unit testing)
// ---------------------------------------------------------------------------

export function verifySignature(body: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function signBody(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ---------------------------------------------------------------------------
// Outbound notification helper (exported for testing)
// ---------------------------------------------------------------------------

export async function postCallback(callbackUrl: string, notification: OutboundNotification, maxRetries = 3): Promise<void> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.post(callbackUrl, notification, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10_000,
        validateStatus: (s) => s >= 200 && s < 300,
      });
      if (res.status >= 200 && res.status < 300) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function startWebhookServer(port: number = Number(process.env.AI_VISION_WEBHOOK_PORT ?? 3001)): Promise<http.Server> {
  const webhookSecret = process.env.WEBHOOK_SECRET ?? '';

  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url ?? '/', true);
    const pathname = parsed.pathname ?? '/';

    if (req.method === 'POST' && pathname === '/webhooks/trigger') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        // Validate signature when WEBHOOK_SECRET is configured
        if (webhookSecret) {
          const sig = req.headers['x-webhook-signature'] as string | undefined;
          if (!verifySignature(body, sig, webhookSecret)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Invalid signature' }));
            return;
          }
        }

        let payload: TriggerPayload;
        try {
          payload = TriggerPayloadSchema.parse(JSON.parse(body || '{}'));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          return;
        }

        const definition = BUILTIN_WORKFLOWS.find((w) => w.id === payload.workflow_id);
        if (!definition) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `Workflow '${payload.workflow_id}' not found` }));
          return;
        }

        // Respond 202 immediately; execution is async
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, workflow_id: payload.workflow_id, status: 'accepted' }));

        const { workflow_id, params, callback_url } = payload;

        (async () => {
          const result = await workflowEngine.run(definition, params ?? {});

          telemetry.emit({
            source: 'webhook',
            name: 'webhook.trigger.completed',
            workflowId: workflow_id,
            durationMs: result.durationMs,
            details: { success: result.success },
          });

          if (callback_url) {
            const notification: OutboundNotification = {
              workflow_id,
              success: result.success,
              outputs: result.outputs,
              durationMs: result.durationMs,
              timestamp: new Date().toISOString(),
              ...(result.error ? { error: result.error } : {}),
            };
            await postCallback(callback_url, notification).catch((e) => {
              telemetry.emit({
                source: 'webhook',
                name: 'webhook.callback.failed',
                level: 'error',
                workflowId: workflow_id,
                details: { callbackUrl: callback_url, error: e instanceof Error ? e.message : String(e) },
              });
            });
          }
        })().catch((e) => {
          console.error('[webhook] Workflow execution error:', e);
          telemetry.emit({
            source: 'webhook',
            name: 'webhook.trigger.failed',
            level: 'error',
            workflowId: workflow_id,
            details: { error: e instanceof Error ? e.message : String(e) },
          });
        });
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.error(`[webhook] Webhook server: http://localhost:${port}`);
  return server;
}
