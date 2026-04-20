import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { ImprovementStore, SicTrigger } from './types';

interface ForgeContextRow {
  value: string;
}

function resolveForgeDbPath(): string {
  return process.env.FORGE_MEMORY_DB_PATH ?? path.join(process.cwd(), 'forge-memory.db');
}

function nowIso(): string {
  return new Date().toISOString();
}

export class ForgeSicMemoryStore {
  private readonly dbPath: string;
  private readonly strictMode: boolean;

  constructor(dbPath: string = resolveForgeDbPath()) {
    this.dbPath = dbPath;
    this.strictMode = process.env.AI_VISION_SIC_FORGE_STRICT !== 'false';
  }

  isStrictMode(): boolean {
    return this.strictMode;
  }

  private withDb<T>(fn: (db: DatabaseSync) => T, required: boolean): T | null {
    if (!fs.existsSync(this.dbPath)) {
      if (required && this.strictMode) {
        throw new Error(`FORGE SIC strict mode enabled, but forge DB is missing at ${this.dbPath}`);
      }
      return null;
    }

    const db = new DatabaseSync(this.dbPath);
    try {
      const hasContextStore = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='context_store'",
      ).get() as { name?: string } | undefined;
      if (!hasContextStore?.name) {
        if (required && this.strictMode) {
          throw new Error('FORGE SIC strict mode enabled, but context_store table is missing');
        }
        return null;
      }
      return fn(db);
    } catch (error) {
      if (required && this.strictMode) {
        throw error;
      }
      return null;
    } finally {
      db.close();
    }
  }

  loadImprovementStore(): ImprovementStore | null {
    return this.withDb(db => {
      const row = db.prepare(
        "SELECT value FROM context_store WHERE key = ? AND scope = 'global'",
      ).get('sic.improvements.store') as ForgeContextRow | undefined;
      if (!row?.value) return null;
      try {
        return JSON.parse(row.value) as ImprovementStore;
      } catch {
        return null;
      }
    }, true);
  }

  saveImprovementStore(store: ImprovementStore): boolean {
    return Boolean(this.withDb(db => {
      const payload = JSON.stringify(store);
      db.prepare(
        `INSERT INTO context_store (key, scope, value, value_type, written_by, updated_at)
         VALUES (?, 'global', ?, 'json', ?, ?)
         ON CONFLICT(key, scope) DO UPDATE SET
           value = excluded.value,
           value_type = excluded.value_type,
           written_by = excluded.written_by,
           updated_at = excluded.updated_at`,
      ).run(
        'sic.improvements.store',
        payload,
        'ai-vision:sic',
        nowIso(),
      );
      return true;
    }, true));
  }

  saveSicTrigger(trigger: SicTrigger): boolean {
    return Boolean(this.withDb(db => {
      db.prepare(
        `INSERT INTO context_store (key, scope, value, value_type, written_by, updated_at)
         VALUES (?, ?, ?, 'json', ?, ?)
         ON CONFLICT(key, scope) DO UPDATE SET
           value = excluded.value,
           value_type = excluded.value_type,
           written_by = excluded.written_by,
           updated_at = excluded.updated_at`,
      ).run(
        `sic.trigger.${trigger.sessionId}`,
        `workflow:${trigger.workflowId}`,
        JSON.stringify(trigger),
        'ai-vision:wrapup',
        nowIso(),
      );

      const hasDiscoveries = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='discoveries'",
      ).get() as { name?: string } | undefined;

      if (hasDiscoveries?.name) {
        db.prepare(
          `INSERT INTO discoveries (story_id, session_id, iteration, type, title, detail, created_at, exported_to_agents_md)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        ).run(
          trigger.workflowId,
          trigger.sessionId,
          0,
          trigger.triggerType === 'failure' ? 'GOTCHA' : 'PATTERN',
          `SIC trigger: ${trigger.workflowName}`,
          JSON.stringify(trigger),
          nowIso(),
        );
      }

      return true;
    }, true));
  }
}

export const forgeSicStore = new ForgeSicMemoryStore();
