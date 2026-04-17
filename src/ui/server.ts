/**
 * HITL (Human-in-the-Loop) web UI server.
 *
 * Serves the control panel at http://localhost:<port>/ and pushes live
 * browser screenshots + session state to connected clients via WebSocket.
 *
 * The UI is intentionally self-contained (no build step) — the HTML/CSS/JS
 * is inlined here so no static file copying is needed.
 *
 * Endpoints:
 *   GET  /              — HITL control panel (HTML)
 *   GET  /api/status    — Current session state (JSON)
 *   GET  /api/screenshot — Current browser screenshot (base64 JSON)
 *   POST /api/return-control — User signals they've finished; resumes workflow
 *   WS   /ws           — Push channel for state/screenshot updates
 */

import * as http from 'http';
import * as url from 'url';
import { sessionManager } from '../session/manager';
import { hitlCoordinator } from '../session/hitl';
import { workflowEngine } from '../workflow/engine';
import { HitlEventPayload, SessionState } from '../session/types';

// ---------------------------------------------------------------------------
// Inline HTML (single-file, no build step)
// ---------------------------------------------------------------------------

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>ai-vision · Control Panel</title>
<style>
  :root {
    --bg: #0f1117; --surface: #1a1d27; --border: #2d3148;
    --accent: #6c63ff; --accent-hover: #8b85ff;
    --text: #e2e8f0; --muted: #8892a4; --success: #34d399;
    --warn: #fbbf24; --danger: #f87171;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; height: 100vh; display: flex; flex-direction: column; }
  header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; align-items: center; gap: 16px; flex-shrink: 0; }
  header h1 { font-size: 18px; font-weight: 600; color: var(--accent); }
  .phase-badge { padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .phase-idle     { background: #2d3148; color: var(--muted); }
  .phase-running  { background: #1e3a5f; color: #60a5fa; }
  .phase-awaiting { background: #3d2b05; color: var(--warn); animation: pulse 1.5s infinite; }
  .phase-complete { background: #064e3b; color: var(--success); }
  .phase-error    { background: #450a0a; color: var(--danger); }
  @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.6 } }
  main { flex: 1; display: grid; grid-template-columns: 320px 1fr; overflow: hidden; }
  aside { background: var(--surface); border-right: 1px solid var(--border); padding: 20px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; }
  .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 8px; }
  .info-row { display: flex; flex-direction: column; gap: 4px; }
  .info-label { font-size: 11px; color: var(--muted); }
  .info-value { font-size: 14px; color: var(--text); word-break: break-all; }
  .hitl-box { background: #251d05; border: 1px solid #92400e; border-radius: 8px; padding: 16px; display: none; }
  .hitl-box.visible { display: block; }
  .hitl-reason { font-size: 16px; font-weight: 600; color: var(--warn); margin-bottom: 8px; }
  .hitl-instructions { font-size: 13px; color: #d97706; line-height: 1.5; }
  .return-btn {
    width: 100%; margin-top: 16px; padding: 14px;
    background: var(--accent); border: none; border-radius: 8px;
    color: white; font-size: 15px; font-weight: 600; cursor: pointer;
    transition: background 0.15s, transform 0.1s;
  }
  .return-btn:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); }
  .return-btn:disabled { background: #3d3d5c; color: var(--muted); cursor: not-allowed; transform: none; }
  .step-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .step-item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 6px 10px; border-radius: 6px; background: var(--bg); }
  .step-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .step-done    .step-dot { background: var(--success); }
  .step-current .step-dot { background: var(--warn); animation: pulse 1s infinite; }
  .step-pending .step-dot { background: #4b5563; }
  .step-error   .step-dot { background: var(--danger); }
  .browser-pane { background: #090c15; display: flex; flex-direction: column; overflow: hidden; }
  .browser-toolbar { background: var(--surface); border-bottom: 1px solid var(--border); padding: 8px 16px; display: flex; align-items: center; gap: 12px; }
  .url-bar { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; font-size: 13px; color: var(--muted); font-family: monospace; }
  .refresh-btn { background: none; border: 1px solid var(--border); color: var(--muted); padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .refresh-btn:hover { border-color: var(--accent); color: var(--accent); }
  .screenshot-area { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 16px; }
  #screenshotImg { max-width: 100%; max-height: 100%; border-radius: 8px; border: 1px solid var(--border); object-fit: contain; }
  .no-screenshot { color: var(--muted); font-size: 14px; text-align: center; }
  .log-pane { background: var(--surface); border-top: 1px solid var(--border); max-height: 140px; overflow-y: auto; padding: 10px 16px; font-size: 12px; font-family: monospace; color: var(--muted); flex-shrink: 0; }
  .log-entry { padding: 2px 0; border-bottom: 1px solid #1a1d27; }
  .log-entry.info { color: #60a5fa; }
  .log-entry.warn { color: var(--warn); }
  .log-entry.ok   { color: var(--success); }
  .log-entry.err  { color: var(--danger); }
  .ws-indicator { width: 8px; height: 8px; border-radius: 50%; background: #4b5563; flex-shrink: 0; }
  .ws-indicator.connected { background: var(--success); }
  .ws-indicator.disconnected { background: var(--danger); }
</style>
</head>
<body>
<header>
  <h1>ai-vision</h1>
  <span id="phaseBadge" class="phase-badge phase-idle">idle</span>
  <span style="flex:1"></span>
  <span style="font-size:12px;color:var(--muted)">WS</span>
  <div id="wsIndicator" class="ws-indicator disconnected"></div>
</header>
<main>
  <aside>
    <!-- HITL action box — shown only when awaiting_human -->
    <div id="hitlBox" class="hitl-box">
      <div class="section-title">Action Required</div>
      <div id="hitlReason" class="hitl-reason"></div>
      <div id="hitlInstructions" class="hitl-instructions"></div>
      <button id="returnBtn" class="return-btn" onclick="returnControl()">
        Return Control to Claude
      </button>
    </div>

    <!-- Current step info -->
    <div>
      <div class="section-title">Session</div>
      <div class="info-row">
        <span class="info-label">Current URL</span>
        <span id="currentUrl" class="info-value" style="color:var(--muted)">—</span>
      </div>
      <div class="info-row" style="margin-top:8px">
        <span class="info-label">Current Step</span>
        <span id="currentStep" class="info-value">—</span>
      </div>
      <div class="info-row" style="margin-top:8px">
        <span class="info-label">Progress</span>
        <span id="progress" class="info-value">—</span>
      </div>
    </div>

    <!-- Auto-refresh toggle -->
    <div>
      <div class="section-title">Screenshot</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
        <input type="checkbox" id="autoRefresh" checked onchange="toggleAutoRefresh(this.checked)" />
        Auto-refresh (1.5s)
      </label>
      <button class="refresh-btn" onclick="fetchScreenshot()" style="margin-top:8px">Refresh now</button>
    </div>
  </aside>

  <div class="browser-pane">
    <div class="browser-toolbar">
      <div id="urlBarDisplay" class="url-bar">about:blank</div>
    </div>
    <div class="screenshot-area">
      <div id="noScreenshot" class="no-screenshot">Browser not started — run a workflow to begin.</div>
      <img id="screenshotImg" src="" alt="Browser screenshot" style="display:none" />
    </div>
    <div id="logPane" class="log-pane"></div>
  </div>
</main>

<script>
let ws = null;
let autoRefreshTimer = null;
let isAwaiting = false;

function connectWs() {
  const wsUrl = 'ws://' + location.host + '/ws';
  ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    document.getElementById('wsIndicator').className = 'ws-indicator connected';
    log('Connected to ai-vision server', 'ok');
  };
  ws.onclose = () => {
    document.getElementById('wsIndicator').className = 'ws-indicator disconnected';
    log('Disconnected — reconnecting in 3s...', 'warn');
    setTimeout(connectWs, 3000);
  };
  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      handleEvent(payload);
    } catch (e) { /* ignore malformed */ }
  };
}

function handleEvent(payload) {
  if (payload.type === 'screenshot' && payload.screenshotBase64) {
    showScreenshot(payload.screenshotBase64);
  }
  if (payload.state) {
    updateState(payload.state);
  }
  if (payload.type === 'takeover_requested') {
    log('Human takeover requested: ' + (payload.state?.hitlReason ?? ''), 'warn');
  }
  if (payload.type === 'control_returned') {
    log('Control returned to Claude', 'ok');
  }
  if (payload.type === 'step_complete') {
    log('Step complete: ' + (payload.state?.currentStep ?? ''), 'info');
  }
}

function updateState(state) {
  const phase = state.phase ?? 'idle';
  isAwaiting = phase === 'awaiting_human';

  // Phase badge
  const badge = document.getElementById('phaseBadge');
  badge.textContent = phase.replace('_', ' ');
  badge.className = 'phase-badge phase-' + (phase === 'awaiting_human' ? 'awaiting' : phase);

  // URL
  if (state.currentUrl) {
    document.getElementById('currentUrl').textContent = state.currentUrl;
    document.getElementById('urlBarDisplay').textContent = state.currentUrl;
  }

  // Step info
  if (state.currentStep) {
    document.getElementById('currentStep').textContent = state.currentStep;
  }
  if (state.stepIndex != null && state.totalSteps != null) {
    document.getElementById('progress').textContent = state.stepIndex + ' / ' + state.totalSteps;
  }

  // HITL box
  const hitlBox = document.getElementById('hitlBox');
  const returnBtn = document.getElementById('returnBtn');
  if (isAwaiting && state.hitlReason) {
    document.getElementById('hitlReason').textContent = state.hitlReason;
    document.getElementById('hitlInstructions').textContent = state.hitlInstructions ?? '';
    hitlBox.classList.add('visible');
    returnBtn.disabled = false;
  } else {
    hitlBox.classList.remove('visible');
    returnBtn.disabled = true;
  }
}

function showScreenshot(base64) {
  const img = document.getElementById('screenshotImg');
  const noShot = document.getElementById('noScreenshot');
  img.src = 'data:image/jpeg;base64,' + base64;
  img.style.display = 'block';
  noShot.style.display = 'none';
}

async function fetchScreenshot() {
  try {
    const resp = await fetch('/api/screenshot');
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.base64) showScreenshot(data.base64);
    if (data.url) document.getElementById('urlBarDisplay').textContent = data.url;
  } catch (e) { /* browser not started */ }
}

function toggleAutoRefresh(enabled) {
  clearInterval(autoRefreshTimer);
  if (enabled) {
    autoRefreshTimer = setInterval(fetchScreenshot, 1500);
  }
}

async function returnControl() {
  document.getElementById('returnBtn').disabled = true;
  document.getElementById('returnBtn').textContent = 'Returning control...';
  try {
    await fetch('/api/return-control', { method: 'POST' });
    log('Control returned to Claude', 'ok');
  } catch (e) {
    log('Failed to return control: ' + e.message, 'err');
    document.getElementById('returnBtn').disabled = false;
    document.getElementById('returnBtn').textContent = 'Return Control to Claude';
  }
}

function log(message, level = 'info') {
  const pane = document.getElementById('logPane');
  const entry = document.createElement('div');
  entry.className = 'log-entry ' + level;
  entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
  pane.appendChild(entry);
  pane.scrollTop = pane.scrollHeight;
}

// Boot
connectWs();
toggleAutoRefresh(true);
fetchScreenshot();
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function startUiServer(port = 3000): Promise<void> {
  // Lazy import ws to avoid loading it during CLI commands that don't need it
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wsModule = (await import('ws')) as any;
  const WebSocketServer = (wsModule.WebSocketServer ?? wsModule.default?.WebSocketServer ?? wsModule.Server) as typeof import('ws').WebSocketServer;

  const wss = new WebSocketServer({ noServer: true });

  // Broadcast to all connected WebSocket clients
  function broadcast(payload: HitlEventPayload): void {
    const msg = JSON.stringify(payload);
    wss.clients.forEach((client) => {
      if (client.readyState === 1 /* OPEN */) {
        client.send(msg);
      }
    });
  }

  // Screenshot push loop when in HITL mode
  let screenshotInterval: ReturnType<typeof setInterval> | null = null;

  function startScreenshotPush(): void {
    stopScreenshotPush();
    screenshotInterval = setInterval(async () => {
      if (!sessionManager.isStarted) return;
      try {
        const base64 = await sessionManager.screenshot();
        const state = workflowEngine.currentState ?? {
          id: 'live', phase: 'awaiting_human' as const,
          startedAt: new Date(), lastUpdatedAt: new Date(),
          currentUrl: await sessionManager.currentUrl().catch(() => undefined),
        };
        broadcast({ type: 'screenshot', state, screenshotBase64: base64 });
      } catch { /* browser not ready */ }
    }, 1200);
  }

  function stopScreenshotPush(): void {
    if (screenshotInterval) { clearInterval(screenshotInterval); screenshotInterval = null; }
  }

  // Wire up HITL events → WebSocket broadcasts
  hitlCoordinator.on('takeover_requested', async ({ reason, instructions }) => {
    const state = workflowEngine.currentState ?? {
      id: 'live', phase: 'awaiting_human' as const,
      startedAt: new Date(), lastUpdatedAt: new Date(),
      hitlReason: reason, hitlInstructions: instructions,
    };
    broadcast({ type: 'takeover_requested', state });
    startScreenshotPush();
  });

  hitlCoordinator.on('control_returned', () => {
    stopScreenshotPush();
    const state = workflowEngine.currentState ?? {
      id: 'live', phase: 'running' as const,
      startedAt: new Date(), lastUpdatedAt: new Date(),
    };
    broadcast({ type: 'control_returned', state });
  });

  hitlCoordinator.on('phase_changed', (state: SessionState) => {
    broadcast({ type: 'phase_changed', state });
  });

  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url ?? '/', true);
    const pathname = parsed.pathname ?? '/';

    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(workflowEngine.currentState ?? { phase: 'idle' }));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/screenshot') {
      if (!sessionManager.isStarted) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Browser not started' }));
        return;
      }
      sessionManager.screenshot()
        .then(async (base64) => {
          const currentUrl = await sessionManager.currentUrl().catch(() => '');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ base64, url: currentUrl }));
        })
        .catch((e) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(e) }));
        });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/return-control') {
      hitlCoordinator.returnControl();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.on('upgrade', (request, socket, head) => {
    if (url.parse(request.url ?? '').pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.error(`[ui] HITL control panel: http://localhost:${port}`);
}
