#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import * as crypto from 'crypto';
import { EngineId } from '../engines/interface';
import { registry } from '../engines/registry';
import { SessionRepository } from '../db/repository';

const program = new Command();
const repo = new SessionRepository();

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
    repo.save(sessionId, engineId, prompt, result);

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
  .action((opts: { limit: string }) => {
    const sessions = repo.list(parseInt(opts.limit, 10));
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
  .description('List available engines')
  .action(() => {
    console.log('Available engines:');
    for (const id of registry.availableEngines()) {
      console.log(`  ${id}`);
    }
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
