#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { EngineId } from '../engines/interface';
import { registry } from '../engines/registry';

// Resolve the project root (works from both src/ and dist/)
const PROJECT_ROOT = (() => {
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return __dirname;
})();

const CONFIG_BIN = path.join(
  PROJECT_ROOT,
  'tools', 'config-gui', 'target', 'release', 'ai-vision-config'
);

const program = new Command();
const WORKFLOW_UI_SHUTDOWN_GRACE_MS = parseInt(
  process.env.AI_VISION_UI_SHUTDOWN_GRACE_MS ?? '1500',
  10,
);
const WORKFLOW_LOCK_FILE = path.join(PROJECT_ROOT, '.workflow-run.lock');

function acquireWorkflowLock(): (() => void) {
  const pid = process.pid;

  if (fs.existsSync(WORKFLOW_LOCK_FILE)) {
    const raw = fs.readFileSync(WORKFLOW_LOCK_FILE, 'utf8').trim();
    const existingPid = parseInt(raw, 10);
    if (!Number.isNaN(existingPid) && existingPid > 0) {
      let processAlive = false;
      try {
        process.kill(existingPid, 0);
        processAlive = true;
      } catch {
        processAlive = false;
      }
      if (processAlive) {
        throw new Error(
          `Another workflow run is already active (pid ${existingPid}). ` +
          `Wait for it to finish or stop it before starting a new run.`,
        );
      }
    }
  }

  fs.writeFileSync(WORKFLOW_LOCK_FILE, `${pid}\n`, 'utf8');

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      if (fs.existsSync(WORKFLOW_LOCK_FILE)) {
        const raw = fs.readFileSync(WORKFLOW_LOCK_FILE, 'utf8').trim();
        if (parseInt(raw, 10) === pid) fs.unlinkSync(WORKFLOW_LOCK_FILE);
      }
    } catch {
      // best effort lock cleanup
    }
  };

  process.on('exit', release);

  return release;
}
// Lazy — only open the DB for commands that actually need it (run, history).
// We also use a dynamic import so the node:sqlite module — and its
// ExperimentalWarning — is never loaded for commands that don't touch the DB.
async function getRepo() {
  const { SessionRepository } = await import('../db/repository');
  return new SessionRepository();
}

program
  .name('ai-vision')
  .description('AI-driven browser automation — run tasks in natural language')
  .version('0.1.0');

program
  .command('run <prompt>')
  .description('Run a natural language browser automation task')
  .option('-e, --engine <engine>', 'Engine to use: browser-use | stagehand | skyvern', 'browser-use')
  .option('-s, --screenshot', 'Take a screenshot after the task completes')
  .action(async (prompt: string, opts: { engine: string; screenshot: boolean }) => {
    const engineId = opts.engine as EngineId;
    const validEngines = registry.availableEngines();
    if (!validEngines.includes(engineId)) {
      console.error(`Unknown engine '${engineId}'. Available: ${validEngines.join(', ')}`);
      process.exit(1);
    }

    console.log(`\nEngine : ${engineId}`);
    console.log(`Prompt : ${prompt}\n`);

    let engine;
    try {
      engine = await registry.getReady(engineId);
    } catch (e) {
      console.error(`Failed to initialize engine: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }

    const result = await engine.runTask(prompt);
    const sessionId = crypto.randomUUID();
    (await getRepo()).save(sessionId, engineId, prompt, result);

    if (result.success) {
      console.log('Status  : success');
      if (result.output) console.log(`Output  : ${result.output}`);
    } else {
      console.error('Status  : failed');
      if (result.error) console.error(`Error   : ${result.error}`);
    }

    if (result.screenshots.length > 0) {
      console.log('Screenshots:');
      for (const s of result.screenshots) {
        console.log(`  ${s.path}`);
      }
    }

    console.log(`Duration: ${result.durationMs}ms`);
    console.log(`Session : ${sessionId}`);

    await registry.closeAll();
    process.exit(result.success ? 0 : 1);
  });

program
  .command('history')
  .description('Show recent task history')
  .option('-n, --limit <n>', 'Number of sessions to show', '10')
  .action(async (opts: { limit: string }) => {
    const sessions = (await getRepo()).list(parseInt(opts.limit, 10));
    if (sessions.length === 0) {
      console.log('No sessions recorded yet.');
      return;
    }
    for (const s of sessions) {
      const status = s.success ? '✓' : '✗';
      console.log(`${status} [${s.engine}] ${s.createdAt} — ${s.prompt.slice(0, 80)}`);
      if (!s.success && s.error) console.log(`  error: ${s.error}`);
    }
  });

program
  .command('engines')
  .description('List available engines and their dependency status')
  .action(async () => {
    console.log('Available engines:');
    for (const id of registry.availableEngines()) {
      const engine = registry.get(id);
      const ok = await engine.available();
      const tag = ok ? '[ready]' : '[not installed — run: npm run setup or check README]';
      console.log(`  ${id.padEnd(12)} ${tag}`);
    }
  });

program
  .command('config')
  .description('Open interactive TUI to configure LLM provider, model, and API key')
  .action(() => {
    if (!process.stdout.isTTY) {
      console.error('The config GUI requires an interactive terminal (TTY).');
      console.error('To configure manually, copy .env.example to .env and fill in the values.');
      process.exit(1);
    }
    if (!fs.existsSync(CONFIG_BIN)) {
      console.error(`Config GUI binary not found at: ${CONFIG_BIN}`);
      console.error('Run: npm run config:build');
      process.exit(1);
    }
    const result = spawnSync(CONFIG_BIN, { stdio: 'inherit' });
    process.exit(result.status ?? 0);
  });

// ---------------------------------------------------------------------------
// serve — starts the MCP server (stdio) + HITL web UI (HTTP) in one process
// ---------------------------------------------------------------------------

program
  .command('serve')
  .description('Start the MCP server and HITL web UI (for use with Claude Code MCP integration)')
  .option('--headed', 'Launch the browser in headed (visible window) mode — required for interactive HITL login flows', false)
  .option('--ui-port <port>', 'Port for the HITL web UI', '3000')
  .option('--cdp-port <port>', 'Chrome remote debugging port (for Python bridge session sharing)', '9223')
  .action(async (opts: { headed: boolean; uiPort: string; cdpPort: string }) => {
    const uiPort = parseInt(opts.uiPort, 10);
    // Set env vars BEFORE any module imports that read them in their constructors
    process.env.AI_VISION_UI_PORT = String(uiPort);
    process.env.AI_VISION_CDP_PORT = opts.cdpPort;
    if (opts.headed) process.env.AI_VISION_HEADED = 'true';

    const { startUiServer } = await import('../ui/server');
    await startUiServer(uiPort);

    const { createMcpServer } = await import('../mcp/server');
    await createMcpServer();
  });

// ---------------------------------------------------------------------------
// workflow — run a named workflow directly from the CLI (without MCP)
// ---------------------------------------------------------------------------

program
  .command('workflow [workflow-id]')
  .description('Run a built-in workflow by ID (use --list to see available workflows)')
  .option('-p, --param <key=value>', 'Workflow parameter (repeatable)', (v: string, acc: string[]) => [...acc, v], [] as string[])
  .option('--headed', 'Launch the browser in headed mode (required for HITL login steps)', false)
  .option('--ui-port <port>', 'Port for the HITL web UI', '3000')
  .option('--list', 'List available workflows and exit')
  .action(async (workflowId: string | undefined, opts: { param: string[]; headed: boolean; uiPort: string; list: boolean }) => {
    let releaseWorkflowLock: (() => void) | null = null;
    let cleanedUp = false;
    const cleanup = async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      try {
        await registry.closeAll();
      } catch {
        // best-effort engine cleanup
      }
      try {
        const { sessionManager } = await import('../session/manager');
        await sessionManager.close();
      } catch {
        // best-effort browser cleanup
      }
    };

    const onSigInt = () => {
      void cleanup().finally(() => process.exit(130));
    };
    const onSigTerm = () => {
      void cleanup().finally(() => process.exit(143));
    };

    process.once('SIGINT', onSigInt);
    process.once('SIGTERM', onSigTerm);

    const { BUILTIN_WORKFLOWS } = await import('../workflow/types');

    if (opts.list || !workflowId) {
      console.log('Available workflows:');
      for (const wf of BUILTIN_WORKFLOWS) {
        console.log(`  ${wf.id.padEnd(24)} ${wf.name}`);
        if (wf.description) console.log(`  ${''.padEnd(24)} ${wf.description}`);
      }
      return;
    }

    const definition = BUILTIN_WORKFLOWS.find((w) => w.id === workflowId!);
    if (!definition) {
      console.error(`Unknown workflow: '${workflowId}'. Run 'ai-vision workflow --list' to see available workflows.`);
      process.exit(1);
    }

    try {
      releaseWorkflowLock = acquireWorkflowLock();
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }

    // Parse key=value params
    const params: Record<string, string> = {};
    for (const p of opts.param) {
      const idx = p.indexOf('=');
      if (idx < 0) { console.error(`Invalid param format: '${p}' (expected key=value)`); process.exit(1); }
      params[p.slice(0, idx)] = p.slice(idx + 1);
    }

    const uiPort = parseInt(opts.uiPort, 10);
    // Set env vars BEFORE module imports so SessionManager singleton reads them in its constructor
    process.env.AI_VISION_UI_PORT = String(uiPort);
    if (opts.headed) process.env.AI_VISION_HEADED = 'true';

    try {
      const { startUiServer } = await import('../ui/server');
      await startUiServer(uiPort);

      const { workflowEngine } = await import('../workflow/engine');
      const sessionId = crypto.randomUUID();
      console.log(`\nWorkflow : ${definition.name}`);
      console.log(`Session  : ${sessionId}`);
      if (opts.headed) {
        console.log(`Browser  : headed (browser window will open)`);
      }
      console.log(`UI       : http://localhost:${uiPort}`);
      console.log('');

      const result = await workflowEngine.run(definition, params, sessionId);
      (await getRepo()).save(sessionId, 'stagehand' /* closest engine-id proxy */, JSON.stringify({ workflowId, params }), {
        success: result.success,
        output: JSON.stringify(result.outputs),
        screenshots: result.screenshots.map((s) => ({ path: s.path, takenAt: new Date() })),
        error: result.error,
        durationMs: result.durationMs,
      });

      if (result.success) {
        console.log('Status   : complete');
        if (Object.keys(result.outputs).length > 0) {
          console.log('Outputs  :');
          for (const [k, v] of Object.entries(result.outputs)) {
            console.log(`  ${k}: ${v}`);
          }
        }
      } else {
        console.error('Status   : failed');
        console.error(`Error    : ${result.error}`);
      }

      console.log(`Duration : ${result.durationMs}ms`);
      if (WORKFLOW_UI_SHUTDOWN_GRACE_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, WORKFLOW_UI_SHUTDOWN_GRACE_MS));
      }
      process.exit(result.success ? 0 : 1);
    } finally {
      process.removeListener('SIGINT', onSigInt);
      process.removeListener('SIGTERM', onSigTerm);
      await cleanup();
      releaseWorkflowLock?.();
    }
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
