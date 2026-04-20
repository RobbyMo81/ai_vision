import * as fs from 'fs';
import * as path from 'path';

export interface TaskMetadataRecord {
  workflowId: string;
  workflowName: string;
  domain: string;
  stepIds: string[];
  transitSteps: string[];
  successCount: number;
  lastSeen: string;
}

interface TaskMetadataStore {
  records: TaskMetadataRecord[];
  lastUpdated: string;
}

function memoryDir(): string {
  return (
    process.env.AI_VISION_MEMORY_DIR ??
    path.join(process.env.HOME ?? process.cwd(), '.ai-vision', 'memory')
  );
}

function metadataFile(): string {
  return path.join(memoryDir(), 'task-metadata.json');
}

function ensureDir(): void {
  fs.mkdirSync(memoryDir(), { recursive: true });
}

export class TaskMetadataManager {
  private store: TaskMetadataStore | null = null;

  private load(): TaskMetadataStore {
    if (this.store) return this.store;
    ensureDir();
    const file = metadataFile();
    if (fs.existsSync(file)) {
      try {
        this.store = JSON.parse(fs.readFileSync(file, 'utf8')) as TaskMetadataStore;
        return this.store;
      } catch {
        // ignore malformed store and recreate
      }
    }
    this.store = { records: [], lastUpdated: new Date().toISOString() };
    return this.store;
  }

  private save(): void {
    ensureDir();
    const store = this.load();
    store.lastUpdated = new Date().toISOString();
    fs.writeFileSync(metadataFile(), JSON.stringify(store, null, 2), 'utf8');
  }

  list(): TaskMetadataRecord[] {
    return this.load().records;
  }

  upsert(record: TaskMetadataRecord): void {
    const store = this.load();
    const idx = store.records.findIndex(
      r => r.workflowId === record.workflowId && r.domain === record.domain,
    );

    if (idx >= 0) {
      store.records[idx] = {
        ...store.records[idx],
        ...record,
        stepIds: Array.from(new Set([...store.records[idx].stepIds, ...record.stepIds])),
        transitSteps: Array.from(
          new Set([...store.records[idx].transitSteps, ...record.transitSteps]),
        ),
        successCount: store.records[idx].successCount + (record.successCount || 0),
        lastSeen: record.lastSeen,
      };
    } else {
      store.records.push(record);
    }

    this.save();
  }
}

export const taskMetadata = new TaskMetadataManager();
