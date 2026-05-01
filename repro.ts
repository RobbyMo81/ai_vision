import { startUiServer } from './src/ui-server';
import WebSocket from 'ws';
import * as fs from 'fs';

async function run() {
  const server = await startUiServer(3016);
  const clientId = 'page-live-repro-4';
  const ws = new WebSocket(`ws://localhost:3016/ws?clientId=${clientId}`);
  
  let wsConnected = false;
  ws.on('open', () => { wsConnected = true; });

  // Wait for WS to connect
  for (let i = 0; i < 10; i++) {
    if (wsConnected) break;
    await new Promise(r => setTimeout(r, 200));
  }

  const confirmRes = await fetch('http://localhost:3016/api/confirm-final-step', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AiVision-Client-Id': clientId
    },
    body: JSON.stringify({
      confirmed: true,
      reason: 'live repro 4',
      sessionId: 'session-live-repro-4',
      requestId: 'req-live-repro-4',
      clientId: clientId
    })
  });

  const confirmHttpStatus = confirmRes.status;
  const confirmResponse = await confirmRes.json();

  // Wait for processing
  await new Promise(r => setTimeout(r, 1000));

  const telRes = await fetch('http://localhost:3016/api/telemetry/recent');
  const events = await telRes.json() as any[];

  const findEvent = (name: string) => events.find(e => e.name === name);

  const evidence = {
    confirmHttpStatus,
    confirmResponse,
    wsConnected,
    confirmReceived: findEvent('ui.hitl.confirm_final_step.received'),
    confirmCompleted: findEvent('ui.hitl.confirm_final_step.completed')
  };

  fs.writeFileSync('/tmp/live-repro-evidence.json', JSON.stringify(evidence, null, 2));
  
  ws.close();
  await server.close();
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
