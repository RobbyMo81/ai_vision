import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';

type Improvement = {
  id: string;
  category: string;
  title: string;
  description: string;
  agentInstruction: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  isSic: boolean;
  workflowIds: string[];
};

type ImprovementStore = {
  improvements: Improvement[];
  lastUpdated: string;
};

type WorkflowSicRow = {
  session_id: string;
  workflow_id: string;
  sic_trigger_json: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function resolveMemoryDir(): string {
  return process.env.AI_VISION_MEMORY_DIR ?? path.join(process.env.HOME ?? process.cwd(), '.ai-vision', 'memory');
}

function resolveForgeDbPath(): string {
  return process.env.FORGE_MEMORY_DB_PATH ?? path.join(process.cwd(), 'forge-memory.db');
}

function resolveAppDbPath(): string {
  return process.env.DB_PATH ?? path.join(process.cwd(), 'ai-vision.db');
}

function loadJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function mergeImprovements(existing: ImprovementStore | null, legacy: ImprovementStore | null): ImprovementStore {
  const merged = new Map<string, Improvement>();

  for (const src of [existing?.improvements ?? [], legacy?.improvements ?? []]) {
    for (const item of src) {
      const current = merged.get(item.id);
      if (!current) {
        merged.set(item.id, { ...item, workflowIds: [...new Set(item.workflowIds ?? [])] });
        continue;
      }

      current.occurrences = Math.max(current.occurrences, item.occurrences);
      current.isSic = current.isSic || item.isSic;
      current.firstSeen = current.firstSeen < item.firstSeen ? current.firstSeen : item.firstSeen;
      current.lastSeen = current.lastSeen > item.lastSeen ? current.lastSeen : item.lastSeen;
      current.description = item.lastSeen >= current.lastSeen ? item.description : current.description;
      current.agentInstruction = item.lastSeen >= current.lastSeen ? item.agentInstruction : current.agentInstruction;
      current.workflowIds = [...new Set([...(current.workflowIds ?? []), ...(item.workflowIds ?? [])])];
    }
  }

  return {
    improvements: [...merged.values()],
    lastUpdated: nowIso(),
  };
}

function main(): void {
  const forgeDbPath = resolveForgeDbPath();
  const appDbPath = resolveAppDbPath();
  const memoryDir = resolveMemoryDir();
  const legacyImprovementPath = path.join(memoryDir, 'improvements.json');

  if (!fs.existsSync(forgeDbPath)) {
    throw new Error(`forge-memory.db not found at ${forgeDbPath}`);
  }

  const forgeDb = new DatabaseSync(forgeDbPath);
  const appDb = fs.existsSync(appDbPath) ? new DatabaseSync(appDbPath) : null;

  try {
    const existingForgeRow = forgeDb
      .prepare("SELECT value FROM context_store WHERE key = ? AND scope = 'global'")
      .get('sic.improvements.store') as { value?: string } | undefined;
    const existingForgeStore = existingForgeRow?.value
      ? (JSON.parse(existingForgeRow.value) as ImprovementStore)
      : null;

    const legacyImprovementStore = loadJsonFile<ImprovementStore>(legacyImprovementPath);
    const mergedStore = mergeImprovements(existingForgeStore, legacyImprovementStore);

    forgeDb
      .prepare(
        `INSERT INTO context_store (key, scope, value, value_type, written_by, updated_at)
         VALUES (?, 'global', ?, 'json', ?, ?)
         ON CONFLICT(key, scope) DO UPDATE SET
           value = excluded.value,
           value_type = excluded.value_type,
           written_by = excluded.written_by,
           updated_at = excluded.updated_at`,
      )
      .run('sic.improvements.store', JSON.stringify(mergedStore), 'ai-vision:migration', nowIso());

    let triggerCount = 0;

    if (appDb) {
      const rows = appDb
        .prepare(
          `SELECT session_id, workflow_id, sic_trigger_json
           FROM workflow_runs
           WHERE sic_trigger_json IS NOT NULL`,
        )
        .all() as WorkflowSicRow[];

      for (const row of rows) {
        if (!row.sic_trigger_json) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.sic_trigger_json);
        } catch {
          continue;
        }

        forgeDb
          .prepare(
            `INSERT INTO context_store (key, scope, value, value_type, written_by, updated_at)
             VALUES (?, ?, ?, 'json', ?, ?)
             ON CONFLICT(key, scope) DO UPDATE SET
               value = excluded.value,
               value_type = excluded.value_type,
               written_by = excluded.written_by,
               updated_at = excluded.updated_at`,
          )
          .run(
            `sic.trigger.${row.session_id}`,
            `workflow:${row.workflow_id}`,
            JSON.stringify(parsed),
            'ai-vision:migration',
            nowIso(),
          );

        triggerCount += 1;
      }
    }

    console.log(`Migrated SIC improvement store (${mergedStore.improvements.length} improvement records) to FORGE.`);
    console.log(`Migrated/Upserted SIC triggers: ${triggerCount}.`);
    console.log('Migration complete. You can now run in FORGE-only SIC mode safely.');
  } finally {
    appDb?.close();
    forgeDb.close();
  }
}

main();
