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
 *   POST /api/confirm-final-step — User confirms or rejects the final agent-executed action
 *   WS   /ws           — Push channel for state/screenshot updates
 */

import * as http from 'http';
import * as url from 'url';
import { sessionManager } from '../session/manager';
import { hitlCoordinator } from '../session/hitl';
import { workflowEngine } from '../workflow/engine';
import { HitlEventPayload, SessionState } from '../session/types';
import { telemetry } from '../telemetry';
import {
  bridgeLifecycleEvents,
  BridgeExitEvent,
  browserUseActionEvents,
  BrowserUseActionEvent,
} from '../engines/python-bridge';

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
  .phase-pre-flight { background: #0f3b2d; color: #7dd3a7; }
  .phase-investigation { background: #2f2348; color: #c4b5fd; }
  .phase-running  { background: #1e3a5f; color: #60a5fa; }
  .phase-awaiting { background: #3d2b05; color: var(--warn); animation: pulse 1.5s infinite; }
  .phase-pii-wait { background: #4a1022; color: #fda4af; animation: pulse 1.5s infinite; }
  .phase-hitl-qa { background: #12324a; color: #7dd3fc; }
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
  .ack-box { background: #0b2030; border: 1px solid #1e3a5f; border-radius: 8px; padding: 14px; }
  .ack-input { width: 100%; margin-top: 6px; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 13px; }
  .ack-actions { display: flex; gap: 8px; margin-top: 10px; }
  .ack-btn { flex: 1; padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; font-size: 13px; }
  .ack-btn:hover { border-color: var(--accent); }
  .secure-box { background: #33111a; border: 1px solid #7f1d1d; border-radius: 8px; padding: 14px; display: none; }
  .secure-box.visible { display: block; }
  .secure-input { width: 100%; margin-top: 8px; padding: 12px; border-radius: 8px; border: 1px solid var(--border); background: #090c15; color: var(--text); font-size: 14px; }
  .telemetry-box { background: #10161f; border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
  .telemetry-entry { font-size: 12px; color: var(--muted); padding: 6px 0; border-bottom: 1px solid #1a1d27; }
  .telemetry-entry:last-child { border-bottom: none; }
  .telemetry-entry.error { color: var(--danger); }
  .telemetry-entry.warn { color: var(--warn); }
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
      <div id="rejectHint" style="display:none;margin-top:10px;font-size:12px;color:#fda4af;line-height:1.4">
        Enter a failure reason in the HITL QA comments below before rejecting.
      </div>
      <button id="rejectBtn" class="ack-btn" onclick="confirmFinalStep(false)" style="display:none;margin-top:6px">
        Mark Final Step Failed
      </button>
    </div>

    <div id="secureInputBox" class="secure-box">
      <div class="section-title">Secure Input</div>
      <div id="secureInputLabel" class="hitl-reason" style="font-size:15px"></div>
      <div style="font-size:12px;color:#fda4af;line-height:1.4">
        Value is submitted to the local server only and excluded from prompts and long-term artifacts.
      </div>
      <input id="secureInput" type="password" class="secure-input" placeholder="Enter sensitive value..." />
      <div class="ack-actions">
        <button class="ack-btn" onclick="submitSecureInput()">Submit Secure Value</button>
        <button class="ack-btn" onclick="clearSecureInput()">Clear</button>
      </div>
    </div>

    <!-- HITL acknowledgment / QA (optional) -->
    <div class="ack-box">
      <div class="section-title">HITL QA</div>
      <div style="font-size:12px;color:var(--muted);line-height:1.4">
        Optional: capture Definition of Done and notes for wrap-up/SIC.
      </div>
      <input id="dodInput" class="ack-input" placeholder="Definition of Done (DoD)..." />
      <textarea id="commentsInput" class="ack-input" rows="4" placeholder="HITL comments..."></textarea>
      <div class="ack-actions">
        <button class="ack-btn" onclick="acknowledge()">Submit QA</button>
        <button class="ack-btn" onclick="clearAck()">Clear</button>
      </div>
    </div>

    <div class="telemetry-box">
      <div class="section-title">Telemetry Alerts</div>
      <div id="telemetryList" style="display:flex;flex-direction:column;gap:0"></div>
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
let telemetryRefreshTimer = null;
let isAwaiting = false;
let isTerminalState = false;
let currentSessionId = '';
const pageClientId = 'page-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

function nextRequestId() {
  return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function connectWs() {
  const wsUrl = 'ws://' + location.host + '/ws?clientId=' + encodeURIComponent(pageClientId);
  ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    document.getElementById('wsIndicator').className = 'ws-indicator connected';
    log('Connected to ai-vision server', 'ok');
  };
  ws.onclose = () => {
    document.getElementById('wsIndicator').className = 'ws-indicator disconnected';
    if (isTerminalState) {
      log('Session finished. UI server closed normally.', 'ok');
      return;
    }
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
  if (payload.type === 'bridge_disconnected') {
    log(payload.state?.error ?? 'Automation bridge disconnected.', 'err');
  }
  if (payload.type === 'browser_use_action' && payload.browserUseEvent) {
    const action = payload.browserUseEvent.actionNames.join(', ');
    const url = payload.browserUseEvent.url ? ' @ ' + payload.browserUseEvent.url : '';
    log('browser-use: ' + action + url, 'info');
  }
}

async function fetchStatus() {
  try {
    const resp = await fetch('/api/status');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const state = await resp.json();
    if (state && state.phase && state.phase !== 'idle') {
      updateState(state);
    } else {
      log('No active workflow state on initial UI load', 'warn');
    }
  } catch (e) {
    log('Failed to fetch current state: ' + e.message, 'err');
  }
}

function updateState(state) {
  if (typeof state.id === 'string' && state.id.length > 0) {
    currentSessionId = state.id;
  }

  const phase = state.phase ?? 'idle';
  const hitlAction = state.hitlAction ?? null;
  isAwaiting = phase === 'awaiting_human' || phase === 'pii_wait' || phase === 'hitl_qa';
  isTerminalState = phase === 'complete' || phase === 'error';

  // Phase badge
  const badge = document.getElementById('phaseBadge');
  badge.textContent = phase.replace('_', ' ');
  let phaseClass = phase;
  if (phase === 'awaiting_human') phaseClass = 'awaiting';
  if (phase === 'pre_flight') phaseClass = 'pre-flight';
  if (phase === 'pii_wait') phaseClass = 'pii-wait';
  if (phase === 'hitl_qa') phaseClass = 'hitl-qa';
  badge.className = 'phase-badge phase-' + phaseClass;

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
  const secureInputBox = document.getElementById('secureInputBox');
  const returnBtn = document.getElementById('returnBtn');
  const rejectBtn = document.getElementById('rejectBtn');
  if (phase === 'pii_wait' && state.hitlFieldLabel) {
    document.getElementById('secureInputLabel').textContent = state.hitlFieldLabel;
    secureInputBox.classList.add('visible');
  } else {
    secureInputBox.classList.remove('visible');
  }

  if ((phase === 'awaiting_human' || phase === 'hitl_qa') && state.hitlReason) {
    document.getElementById('hitlReason').textContent = state.hitlReason;
    document.getElementById('hitlInstructions').textContent = state.hitlInstructions ?? '';
    hitlBox.classList.add('visible');
    returnBtn.disabled = false;
    if (hitlAction === 'confirm_completion') {
      returnBtn.textContent = 'Confirm Final Step';
      returnBtn.onclick = () => confirmFinalStep(true);
      rejectBtn.style.display = 'block';
      document.getElementById('rejectHint').style.display = 'block';
    } else if (hitlAction === 'verify_authentication') {
      returnBtn.textContent = 'Verified / Continue';
      returnBtn.onclick = () => returnControl();
      rejectBtn.style.display = 'none';
    } else if (hitlAction === 'approve_draft') {
      returnBtn.textContent = 'Approve Draft & Begin Posting';
      returnBtn.onclick = () => returnControl();
      rejectBtn.style.display = 'none';
    } else if (hitlAction === 'capture_notes') {
      returnBtn.textContent = 'Dismiss & Close';
      returnBtn.onclick = () => returnControl();
      rejectBtn.style.display = 'none';
    } else {
      returnBtn.textContent = 'Return Control to Claude';
      returnBtn.onclick = () => returnControl();
      rejectBtn.style.display = 'none';
    }
  } else {
    hitlBox.classList.remove('visible');
    returnBtn.disabled = true;
    rejectBtn.style.display = 'none';
    document.getElementById('rejectHint').style.display = 'none';
  }

  if (isTerminalState && !isAwaiting) {
    clearInterval(autoRefreshTimer);
    clearInterval(telemetryRefreshTimer);
  }
}

function renderTelemetry(entries) {
  const list = document.getElementById('telemetryList');
  list.innerHTML = '';
  if (!entries || entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'telemetry-entry';
    empty.textContent = 'No telemetry alerts yet.';
    list.appendChild(empty);
    return;
  }

  entries.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'telemetry-entry ' + (entry.issue?.severity ?? '');
    item.textContent = '[' + new Date(entry.createdAt).toLocaleTimeString() + '] ' + (entry.issue?.message ?? entry.name);
    list.appendChild(item);
  });
}

async function fetchTelemetry() {
  try {
    const resp = await fetch('/api/telemetry/recent');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    renderTelemetry(data.alerts ?? []);
  } catch (e) {
    if (isTerminalState) return;
    log('Failed to fetch telemetry: ' + e.message, 'err');
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
    const requestId = nextRequestId();
    await fetch('/api/return-control', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AiVision-Client-Id': pageClientId,
      },
      body: JSON.stringify({
        sessionId: currentSessionId,
        requestId,
        clientId: pageClientId,
      }),
    });
    log('Control returned to Claude', 'ok');
  } catch (e) {
    log('Failed to return control: ' + e.message, 'err');
    document.getElementById('returnBtn').disabled = false;
    document.getElementById('returnBtn').textContent = 'Return Control to Claude';
  }
}

async function confirmFinalStep(confirmed) {
  const reason = (document.getElementById('commentsInput').value ?? '').trim();
  if (!confirmed && !reason) {
    log('A failure reason is required before rejecting. Enter it in the HITL QA comments.', 'warn');
    document.getElementById('commentsInput').focus();
    return;
  }
  document.getElementById('returnBtn').disabled = true;
  document.getElementById('rejectBtn').disabled = true;
  try {
    const requestId = nextRequestId();
    const resp = await fetch('/api/confirm-final-step', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AiVision-Client-Id': pageClientId,
      },
      body: JSON.stringify({
        confirmed,
        reason,
        sessionId: currentSessionId,
        requestId,
        clientId: pageClientId,
      }),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    log(confirmed ? 'Final step confirmed by HITL' : 'Final step rejected by HITL', confirmed ? 'ok' : 'warn');
  } catch (e) {
    log('Failed to submit final-step confirmation: ' + e.message, 'err');
    document.getElementById('returnBtn').disabled = false;
    document.getElementById('rejectBtn').disabled = false;
  }
}

async function acknowledge() {
  const dod = document.getElementById('dodInput').value ?? '';
  const comments = document.getElementById('commentsInput').value ?? '';
  try {
    const resp = await fetch('/api/acknowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dod, comments }),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    log('HITL QA submitted', 'ok');
  } catch (e) {
    log('Failed to submit QA: ' + e.message, 'err');
  }
}

function clearAck() {
  document.getElementById('dodInput').value = '';
  document.getElementById('commentsInput').value = '';
}

async function submitSecureInput() {
  const value = document.getElementById('secureInput').value ?? '';
  try {
    const resp = await fetch('/api/pii-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    clearSecureInput();
    log('Secure value submitted', 'ok');
  } catch (e) {
    log('Failed to submit secure value: ' + e.message, 'err');
  }
}

function clearSecureInput() {
  document.getElementById('secureInput').value = '';
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
fetchStatus();
toggleAutoRefresh(true);
fetchScreenshot();
fetchTelemetry();
telemetryRefreshTimer = setInterval(fetchTelemetry, 5000);
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function startUiServer(port = 3000): Promise<http.Server> {
  // Destructured import gives a fully-typed WebSocketServer without any cast.
  const { WebSocketServer } = await import('ws');

  const wss = new WebSocketServer({ noServer: true });
  let websocketSeq = 0;
  const websocketIds = new WeakMap<object, string>();
  const websocketPageIds = new WeakMap<object, string>();
  const pageIdToSockets = new Map<string, Set<string>>();

  function headerValue(value: string | string[] | undefined): string {
    if (Array.isArray(value)) return value.join(', ');
    return value ?? '';
  }

  function callerMetadata(req: http.IncomingMessage): Record<string, unknown> {
    return {
      remoteAddress: req.socket.remoteAddress ?? '',
      remotePort: req.socket.remotePort ?? 0,
      forwardedFor: headerValue(req.headers['x-forwarded-for']),
      userAgent: headerValue(req.headers['user-agent']),
      origin: headerValue(req.headers.origin),
      referer: headerValue(req.headers.referer),
      host: headerValue(req.headers.host),
      method: req.method ?? '',
      path: req.url ?? '',
    };
  }

  function nextWebSocketId(): string {
    websocketSeq += 1;
    return `ws-${Date.now()}-${websocketSeq}`;
  }

  function parseClientId(request: http.IncomingMessage): string {
    const parsed = url.parse(request.url ?? '', true);
    const queryClientId = parsed.query.clientId;
    if (typeof queryClientId === 'string' && queryClientId.trim().length > 0) {
      return queryClientId.trim();
    }
    return '';
  }

  function addSocketForPage(pageClientId: string, wsClientId: string): void {
    if (!pageClientId) return;
    const existing = pageIdToSockets.get(pageClientId) ?? new Set<string>();
    existing.add(wsClientId);
    pageIdToSockets.set(pageClientId, existing);
  }

  function removeSocketForPage(pageClientId: string, wsClientId: string): void {
    if (!pageClientId) return;
    const existing = pageIdToSockets.get(pageClientId);
    if (!existing) return;
    existing.delete(wsClientId);
    if (existing.size === 0) {
      pageIdToSockets.delete(pageClientId);
    }
  }

  function socketsForPage(pageClientId: string): string[] {
    if (!pageClientId) return [];
    return Array.from(pageIdToSockets.get(pageClientId) ?? []);
  }

  function connectionCount(): number {
    return wss.clients.size;
  }

  telemetry.emit({
    source: 'ui',
    name: 'ui.server.started',
    details: { port },
  });

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

  bridgeLifecycleEvents.on('bridge_exit', (event: BridgeExitEvent) => {
    if (!event.unexpected) return;

    const now = new Date();
    const current = workflowEngine.currentState;
    const disconnectedState: SessionState = {
      id: current?.id ?? 'bridge-disconnected',
      phase: 'error',
      startedAt: current?.startedAt ?? now,
      lastUpdatedAt: now,
      ...current,
      error: `Automation bridge '${event.engineId}' disconnected unexpectedly (code=${event.code ?? 'null'}, signal=${event.signal ?? 'null'}).`,
    };

    telemetry.emit({
      source: 'ui',
      name: 'ui.bridge.disconnected',
      level: 'error',
      details: {
        engineId: event.engineId,
        code: event.code ?? 'null',
        signal: event.signal ?? 'null',
      },
    });

    broadcast({ type: 'bridge_disconnected', state: disconnectedState });
  });

  browserUseActionEvents.on('browser_use_action', (event: BrowserUseActionEvent) => {
    const now = new Date();
    const current = workflowEngine.currentState;
    const actionSummary = event.actionNames.join(', ');
    const state: SessionState = {
      id: event.sessionId ?? current?.id ?? 'browser-use-live',
      phase: current?.phase ?? 'running',
      startedAt: current?.startedAt ?? now,
      lastUpdatedAt: now,
      ...current,
      currentStep: current?.currentStep ?? `browser-use: ${actionSummary}`,
      currentUrl: event.url ?? current?.currentUrl,
    };

    broadcast({ type: 'browser_use_action', state, browserUseEvent: event });
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

    if (req.method === 'GET' && pathname === '/api/telemetry/recent') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        alerts: telemetry.recentAlerts(10),
        events: telemetry.recent(25),
      }));
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
          telemetry.emit({
            source: 'ui',
            name: 'ui.screenshot.failed',
            level: 'warn',
            details: {
              error: e instanceof Error ? e.message : String(e),
            },
          });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(e) }));
        });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/return-control') {
      let rcBody = '';
      req.on('data', (chunk) => { rcBody += chunk; });
      req.on('end', () => {
        let rcParsed: { sessionId?: string; requestId?: string; clientId?: string } = {};
        try {
          rcParsed = JSON.parse(rcBody || '{}') as { sessionId?: string; requestId?: string; clientId?: string };
        } catch {
          // empty body OK
        }
        const current = workflowEngine.currentState;
        const requestId = (rcParsed.requestId ?? '').trim();
        const requestSessionId = (rcParsed.sessionId ?? '').trim();
        const requestClientId = (rcParsed.clientId ?? '').trim();
        const headerClientId = headerValue(req.headers['x-aivision-client-id']).trim();
        const resolvedClientId = requestClientId || headerClientId;
        const requestRunBinding =
          requestSessionId.length > 0
            ? requestSessionId === (current?.id ?? '')
            : undefined;
        const matchingSocketIds = socketsForPage(resolvedClientId);
        const caller = callerMetadata(req);

        telemetry.emit({
          source: 'ui',
          name: 'ui.hitl.return_control.received',
          level: 'info',
          sessionId: current?.id,
          details: {
            requestId,
            requestSessionId,
            activeSessionId: current?.id ?? '',
            requestRunBinding,
            requestClientId,
            headerClientId,
            resolvedClientId,
            matchingWsClientIds: matchingSocketIds,
            matchingWsClientCount: matchingSocketIds.length,
            wsConnectionCount: connectionCount(),
            currentPhase: current?.phase ?? 'idle',
            currentHitlAction: current?.hitlAction ?? '',
            currentStep: current?.currentStep ?? '',
            ...caller,
          },
        });

        const emitReturnControlRejection = (gate: string, rejReason: string): void => {
          telemetry.emit({
            source: 'ui',
            name: 'ui.hitl.return_control.rejected',
            level: 'warn',
            sessionId: current?.id,
            details: {
              gate,
              reason: rejReason,
              requestId,
              requestSessionId,
              activeSessionId: current?.id ?? '',
              requestRunBinding,
              requestClientId,
              headerClientId,
              resolvedClientId,
              matchingWsClientIds: matchingSocketIds,
              matchingWsClientCount: matchingSocketIds.length,
              currentPhase: current?.phase ?? 'idle',
              currentHitlAction: current?.hitlAction ?? '',
              currentStep: current?.currentStep ?? '',
              wsConnectionCount: connectionCount(),
              ...caller,
            },
          });
        };

        const isAllowedReturnControlState =
          (current?.phase === 'awaiting_human' &&
            (current?.hitlAction === 'return_control' || current?.hitlAction === 'verify_authentication')) ||
          (current?.phase === 'hitl_qa' &&
            (
              current?.hitlAction === 'approve_draft' ||
              current?.hitlAction === 'capture_notes' ||
              current?.hitlAction === 'approve_step'
            ));

        if (!isAllowedReturnControlState) {
          emitReturnControlRejection('return_control_action_gate', 'No active return-control wait in progress');
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No active return-control wait in progress' }));
          return;
        }

        if (requestSessionId.length > 0 && requestSessionId !== (current?.id ?? '')) {
          emitReturnControlRejection('session_binding_gate', 'Session ID mismatch');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session ID mismatch' }));
          return;
        }

        if (resolvedClientId.length > 0 && matchingSocketIds.length === 0) {
          emitReturnControlRejection('websocket_presence_gate', 'No active UI session for this client');
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No active UI session for this client' }));
          return;
        }

        hitlCoordinator.returnControl();

        telemetry.emit({
          source: 'ui',
          name: 'ui.hitl.return_control.completed',
          level: 'info',
          sessionId: current?.id,
          details: {
            requestId,
            requestSessionId,
            activeSessionId: current?.id ?? '',
            requestRunBinding,
            requestClientId,
            headerClientId,
            resolvedClientId,
            matchingWsClientIds: matchingSocketIds,
            matchingWsClientCount: matchingSocketIds.length,
            wsConnectionCount: connectionCount(),
            currentPhase: current?.phase ?? 'idle',
            currentHitlAction: current?.hitlAction ?? '',
            currentStep: current?.currentStep ?? '',
            ...caller,
          },
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/confirm-final-step') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}') as {
            confirmed?: boolean;
            reason?: string;
            sessionId?: string;
            requestId?: string;
            clientId?: string;
          };
          const current = workflowEngine.currentState;
          const reason = parsed.reason?.trim() ?? '';
          const requestSessionId = parsed.sessionId?.trim() ?? '';
          const requestClientId = parsed.clientId?.trim() ?? '';
          const headerClientId = headerValue(req.headers['x-aivision-client-id']).trim();
          const clientId = requestClientId || headerClientId;
          const requestRunBinding =
            requestSessionId.length > 0
              ? requestSessionId === (current?.id ?? '')
              : undefined;
          const matchingSocketIds = socketsForPage(clientId);

          telemetry.emit({
            source: 'ui',
            name: 'ui.hitl.confirm_final_step.received',
            level: 'info',
            sessionId: current?.id,
            details: {
              confirmed: Boolean(parsed.confirmed),
              requestId: parsed.requestId ?? '',
              requestSessionId,
              activeSessionId: current?.id ?? '',
              requestRunBinding,
              requestClientId,
              headerClientId,
              resolvedClientId: clientId,
              matchingWsClientIds: matchingSocketIds,
              matchingWsClientCount: matchingSocketIds.length,
              currentPhase: current?.phase ?? 'idle',
              currentHitlAction: current?.hitlAction ?? '',
              currentStep: current?.currentStep ?? '',
              wsConnectionCount: connectionCount(),
              ...callerMetadata(req),
            },
          });

          const emitConfirmationRejection = (gate: string, rejReason: string): void => {
            telemetry.emit({
              source: 'ui',
              name: 'ui.hitl.confirm_final_step.rejected',
              level: 'warn',
              sessionId: current?.id,
              details: {
                gate,
                reason: rejReason,
                requestSessionId,
                activeSessionId: current?.id ?? '',
                resolvedClientId: clientId,
                matchingWsClientCount: matchingSocketIds.length,
                wsConnectionCount: connectionCount(),
                ...callerMetadata(req),
              },
            });
          };

          if (current?.phase !== 'hitl_qa') {
            emitConfirmationRejection('run_phase_gate', 'No active final confirmation in progress');
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No active final confirmation in progress' }));
            return;
          }

          if (requestSessionId.length > 0 && requestSessionId !== (current?.id ?? '')) {
            emitConfirmationRejection('session_binding_gate', 'Session ID mismatch');
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session ID mismatch' }));
            return;
          }

          if (clientId.length > 0 && matchingSocketIds.length === 0) {
            emitConfirmationRejection('websocket_presence_gate', 'No active UI session for this client');
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No active UI session for this client' }));
            return;
          }

          if (current) {
            (current as SessionState).hitlAckAt = new Date().toISOString();
            (current as SessionState).hitlOutcomeConfirmed = Boolean(parsed.confirmed);
            if (!parsed.confirmed) {
              (current as SessionState).hitlComments =
                reason || (current as SessionState).hitlComments || '';
              (current as SessionState).hitlFailureReason = reason || 'HITL rejected the final outcome.';
              (current as SessionState).hitlFailureStepId =
                (current as SessionState).currentStep ?? (current as SessionState).hitlFailureStepId;
            }
          }
          hitlCoordinator.confirmCompletion(Boolean(parsed.confirmed), reason);

          telemetry.emit({
            source: 'ui',
            name: 'ui.hitl.confirm_final_step.completed',
            level: parsed.confirmed ? 'info' : 'warn',
            sessionId: current?.id,
            details: {
              confirmed: Boolean(parsed.confirmed),
              requestId: parsed.requestId ?? '',
              requestSessionId,
              activeSessionId: current?.id ?? '',
              requestRunBinding,
              requestClientId,
              headerClientId,
              resolvedClientId: clientId,
              matchingWsClientIds: matchingSocketIds,
              matchingWsClientCount: matchingSocketIds.length,
              currentPhase: current?.phase ?? 'idle',
              currentHitlAction: current?.hitlAction ?? '',
              currentStep: current?.currentStep ?? '',
              wsConnectionCount: connectionCount(),
              ...callerMetadata(req),
            },
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, confirmed: Boolean(parsed.confirmed), reason }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/pii-input') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}') as { value?: string };
          hitlCoordinator.submitSensitiveValue(parsed.value ?? '');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/acknowledge') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}') as { dod?: string; comments?: string };
          const now = new Date().toISOString();
          const current = workflowEngine.currentState;
          if (current) {
            // Store on the live session state for later ETL pickup.
            (current as SessionState).hitlDod = parsed.dod ?? '';
            (current as SessionState).hitlComments = parsed.comments ?? '';
            (current as SessionState).hitlAckAt = now;
            hitlCoordinator.emit('phase_changed', current);
          }
          telemetry.emit({
            source: 'ui',
            name: 'ui.hitl.acknowledged',
            details: {
              hasDod: Boolean(parsed.dod),
              hasComments: Boolean(parsed.comments),
            },
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, at: now }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        }
      });
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

  wss.on('connection', (ws, request) => {
    const wsId = nextWebSocketId();
    const pageClientId = parseClientId(request);
    websocketIds.set(ws, wsId);
    websocketPageIds.set(ws, pageClientId);
    addSocketForPage(pageClientId, wsId);

    telemetry.emit({
      source: 'ui',
      name: 'ui.ws.connected',
      details: {
        wsClientId: wsId,
        pageClientId,
        pageWsClientIds: socketsForPage(pageClientId),
        wsConnectionCount: connectionCount(),
        ...callerMetadata(request),
      },
    });
    ws.on('close', () => {
      const trackedWsId = websocketIds.get(ws) ?? '';
      const trackedPageClientId = websocketPageIds.get(ws) ?? '';
      removeSocketForPage(trackedPageClientId, trackedWsId);

      telemetry.emit({
        source: 'ui',
        name: 'ui.ws.disconnected',
        level: 'warn',
        details: {
          wsClientId: trackedWsId,
          pageClientId: trackedPageClientId,
          pageWsClientIds: socketsForPage(trackedPageClientId),
          wsConnectionCount: connectionCount(),
        },
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.error(`[ui] HITL control panel: http://localhost:${port}`);
  return server;
}
