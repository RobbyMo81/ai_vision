import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { EngineId, TaskResult } from '../engines/interface';
import { TaskMetadataRecord } from '../memory/metadata';
import { TelemetryEvent } from '../telemetry/types';

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

export interface WorkflowRunRecord {
  sessionId: string;
  workflowId: string;
  workflowName: string;
  success: boolean;
  resultJson: string;
  stateJson?: string;
  shortTermJson?: string;
  scratchPadMarkdown?: string;
  sicTriggerJson?: string;
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

  saveWorkflowRun(record: WorkflowRunRecord): void {
    this.db.prepare(`
      INSERT INTO workflow_runs (
        session_id, workflow_id, workflow_name, success, result_json,
        state_json, short_term_json, scratch_pad_markdown, sic_trigger_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        workflow_id = excluded.workflow_id,
        workflow_name = excluded.workflow_name,
        success = excluded.success,
        result_json = excluded.result_json,
        state_json = excluded.state_json,
        short_term_json = excluded.short_term_json,
        scratch_pad_markdown = excluded.scratch_pad_markdown,
        sic_trigger_json = excluded.sic_trigger_json
    `).run(
      record.sessionId,
      record.workflowId,
      record.workflowName,
      record.success ? 1 : 0,
      record.resultJson,
      record.stateJson ?? null,
      record.shortTermJson ?? null,
      record.scratchPadMarkdown ?? null,
      record.sicTriggerJson ?? null,
    );
  }

  saveTaskMetadata(record: TaskMetadataRecord): void {
    this.db.prepare(`
      INSERT INTO task_metadata (workflow_id, workflow_name, domain, metadata_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workflow_id, domain) DO UPDATE SET
        workflow_name = excluded.workflow_name,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      record.workflowId,
      record.workflowName,
      record.domain,
      JSON.stringify(record),
      record.lastSeen,
    );
  }

  saveTelemetryEvent(event: TelemetryEvent): void {
    this.db.prepare(`
      INSERT INTO telemetry_events (
        id, name, level, source, session_id, workflow_id, step_id,
        duration_ms, details_json, issue_code, issue_severity, issue_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.name,
      event.level,
      event.source,
      event.sessionId ?? null,
      event.workflowId ?? null,
      event.stepId ?? null,
      event.durationMs ?? null,
      JSON.stringify(event.details),
      event.issue?.code ?? null,
      event.issue?.severity ?? null,
      event.issue?.message ?? null,
      event.createdAt,
    );
  }

  listTelemetry(limit = 50): TelemetryEvent[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM telemetry_events
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `).all(limit) as Array<{
      id: string;
      name: string;
      level: TelemetryEvent['level'];
      source: TelemetryEvent['source'];
      session_id: string | null;
      workflow_id: string | null;
      step_id: string | null;
      duration_ms: number | null;
      details_json: string;
      issue_code: string | null;
      issue_severity: 'warn' | 'error' | null;
      issue_message: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      level: row.level,
      source: row.source,
      sessionId: row.session_id ?? undefined,
      workflowId: row.workflow_id ?? undefined,
      stepId: row.step_id ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      details: JSON.parse(row.details_json) as Record<string, unknown>,
      createdAt: row.created_at,
      issue: row.issue_code && row.issue_severity && row.issue_message
        ? {
            code: row.issue_code,
            severity: row.issue_severity,
            message: row.issue_message,
          }
        : undefined,
    }));
  }

  listTelemetryAlerts(limit = 20): TelemetryEvent[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM telemetry_events
      WHERE issue_severity IS NOT NULL
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `).all(limit) as Array<{
      id: string;
      name: string;
      level: TelemetryEvent['level'];
      source: TelemetryEvent['source'];
      session_id: string | null;
      workflow_id: string | null;
      step_id: string | null;
      duration_ms: number | null;
      details_json: string;
      issue_code: string | null;
      issue_severity: 'warn' | 'error' | null;
      issue_message: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      level: row.level,
      source: row.source,
      sessionId: row.session_id ?? undefined,
      workflowId: row.workflow_id ?? undefined,
      stepId: row.step_id ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      details: JSON.parse(row.details_json) as Record<string, unknown>,
      createdAt: row.created_at,
      issue: row.issue_code && row.issue_severity && row.issue_message
        ? {
            code: row.issue_code,
            severity: row.issue_severity,
            message: row.issue_message,
          }
        : undefined,
    }));
  }

  private _migrate(): void {
    const migrationDir = path.resolve(__dirname, 'migrations');
    if (!fs.existsSync(migrationDir)) return;
    const files = fs
      .readdirSync(migrationDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
      this.db.exec(sql);
    }
  }
}
