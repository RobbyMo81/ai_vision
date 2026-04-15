import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { EngineId, TaskResult } from '../engines/interface';

export interface SessionRecord {
  id: string;
  engine: EngineId;
  prompt: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs?: number;
  createdAt: string;
  screenshots: string[];
}

export class SessionRepository {
  private db: DatabaseSync;

  constructor(dbPath: string = process.env.DB_PATH ?? './ai-vision.db') {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this._migrate();
  }

  save(id: string, engine: EngineId, prompt: string, result: TaskResult): void {
    const insert = this.db.prepare(`
      INSERT INTO sessions (id, engine, prompt, success, output, error, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertShot = this.db.prepare(`
      INSERT INTO session_screenshots (session_id, path, taken_at) VALUES (?, ?, ?)
    `);

    // node:sqlite doesn't have an explicit transaction helper, 
    // but we can use exec('BEGIN') / exec('COMMIT')
    try {
      this.db.exec('BEGIN');
      insert.run(
        id,
        engine,
        prompt,
        result.success ? 1 : 0,
        result.output ?? null,
        result.error ?? null,
        result.durationMs
      );
      for (const s of result.screenshots) {
        insertShot.run(
          id,
          s.path,
          s.takenAt.toISOString()
        );
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  list(limit = 20): SessionRecord[] {
    // FIX-10: Use json_group_array instead of GROUP_CONCAT to safely handle
    // screenshot paths that contain commas (the old comma-split was lossy).
    const rows = this.db.prepare(`
      SELECT s.*, json_group_array(ss.path) FILTER (WHERE ss.path IS NOT NULL) as screenshot_paths
      FROM sessions s
      LEFT JOIN session_screenshots ss ON ss.session_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT ?
    `).all(limit) as Array<{
      id: string;
      engine: string;
      prompt: string;
      success: number;
      output: string | null;
      error: string | null;
      duration_ms: number | null;
      created_at: string;
      screenshot_paths: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      engine: r.engine as EngineId,
      prompt: r.prompt,
      success: r.success === 1,
      output: r.output ?? undefined,
      error: r.error ?? undefined,
      durationMs: r.duration_ms ?? undefined,
      createdAt: r.created_at,
      screenshots: r.screenshot_paths ? (JSON.parse(r.screenshot_paths) as string[]) : [],
    }));
  }

  private _migrate(): void {
    const migrationPath = path.resolve(__dirname, 'migrations/001_init.sql');
    if (fs.existsSync(migrationPath)) {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      this.db.exec(sql);
    }
  }
}
