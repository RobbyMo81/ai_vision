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

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
