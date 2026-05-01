/**
 * FORGE Memory Client — forge-memory-client.ts
 *
 * TypeScript interface to forge-memory.db for agent use.
 * Every Claude Code instance in the FORGE loop imports this.
 *
 * GOVERNANCE: See MEMORY_PROTOCOL.md
 * REQUIRED: Read on entry, write on exit.
 *
 * Dependencies: node:sqlite (built into the pinned Node 24 runtime)
 */

import { readFileSync, existsSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';

// ── Types ─────────────────────────────────────────────────

export type MessageType = 'DISCOVERY' | 'BLOCKER' | 'HANDOFF' | 'WARNING' | 'STATUS' | 'DECISION';
export type DiscoveryType = 'PATTERN' | 'GOTCHA' | 'BLOCKER' | 'DECISION' | 'DEPENDENCY' | 'CONVENTION';
export type ContextValueType = 'text' | 'json' | 'path' | 'url';
export type IterationStatus = 'running' | 'pass' | 'fail' | 'blocked';
export type GateResult = 'pass' | 'fail' | 'skipped';

export interface AgentMessage {
  id: number;
  from_session: string;
  from_iter: number | null;
  story_id: string | null;
  message_type: MessageType;
  subject: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface Discovery {
  id: number;
  story_id: string;
  session_id: string;
  iteration: number;
  type: DiscoveryType;
  title: string;
  detail: string;
  created_at: string;
  // Schema compatibility flag for exported discoveries; retained for existing DBs.
  exported_to_agents_md: number;
}

export interface ContextEntry {
  key: string;
  scope: string;
  value: string;
  value_type: ContextValueType;
  written_by: string;
  updated_at: string;
}

export interface StoryState {
  story_id: string;
  attempt_count: number;
  last_error: string | null;
  blockers: string[] | null;
  context_notes: string | null;
  last_session: string | null;
  last_updated: string;
}

export interface EntryContext {
  messages: AgentMessage[];
  storyState: StoryState | null;
  contextStore: ContextEntry[];
  startupReport: string;
}

interface StoryStateRow {
  story_id: string;
  attempt_count: number;
  last_error: string | null;
  blockers: string | null;
  context_notes: string | null;
  last_session: string | null;
  last_updated: string;
}

// ── ForgeMemory Class ─────────────────────────────────────

export class ForgeMemory {
  private db: DatabaseSync;
  private sessionId: string;
  private iteration: number;
  private storyId: string;

  constructor(
    dbPath: string = 'forge-memory.db',
    sessionId: string,
    iteration: number,
    storyId: string
  ) {
    if (!existsSync(dbPath)) {
      throw new Error(
        `[FORGE MEMORY] DB not found at: ${dbPath}\n` +
        `forge.sh must run before any agent. The DB is initialized at startup.\n` +
        `MEMORY_PROTOCOL.md Rule 1 violation.`
      );
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');

    this.sessionId = sessionId;
    this.iteration = iteration;
    this.storyId = storyId;
  }

  // ── ENTRY OBLIGATIONS (Function 0) ──────────────────────

  /**
   * Complete Function 0 entry sequence.
   * MUST be called before any implementation work.
   * Returns full context briefing for this agent instance.
   */
  async entry(): Promise<EntryContext> {
    console.log('\n[FORGE MEMORY] ── Function 0 Entry Gate ─────────────────────');

    // 1. Read startup report
    const startupReport = this.readStartupReport();
    console.log('[FORGE MEMORY] ✓ Startup report loaded');

    // 2. Get unread messages
    const messages = this.getUnreadMessages();
    console.log(`[FORGE MEMORY] ✓ ${messages.length} unread message(s) loaded`);

    // 3. Mark messages as read
    this.markMessagesRead();
    console.log('[FORGE MEMORY] ✓ Messages marked read');

    // 4. Get story state
    const storyState = this.getStoryState(this.storyId);
    if (storyState) {
      console.log(`[FORGE MEMORY] ✓ Story state: ${storyState.attempt_count} prior attempt(s)`);
      if (storyState.last_error) {
        console.log(`[FORGE MEMORY] ⚠ Last error: ${storyState.last_error}`);
      }
      if (storyState.blockers?.length) {
        console.log(`[FORGE MEMORY] ⚠ Active blockers: ${storyState.blockers.join(', ')}`);
      }
    }

    // 5. Get context store
    const contextStore = this.getContextForStory(this.storyId);
    console.log(`[FORGE MEMORY] ✓ Context store: ${contextStore.length} relevant entries`);

    // 6. Audit entry
    this.audit('AGENT_ENTRY', 'agent_iterations', `story=${this.storyId} iter=${this.iteration}`);

    console.log('[FORGE MEMORY] ── Entry Gate Complete ──────────────────────────\n');

    return { messages, storyState, contextStore, startupReport };
  }

  /**
   * Complete Function 0 exit sequence.
   * MUST be called before agent stops. Quality gates should pass first.
   */
  async exit(opts: {
    status: IterationStatus;
    gateResult: GateResult;
    summary: string;
    discoveries?: Array<{ type: DiscoveryType; title: string; detail: string }>;
    contextEntries?: Array<{ key: string; value: string; scope?: string; valueType?: ContextValueType }>;
    storyNotes?: string;
    lastError?: string;
    blockers?: string[];
  }): Promise<void> {
    console.log('\n[FORGE MEMORY] ── Exit Protocol ────────────────────────────────');

    const { status, gateResult, summary, discoveries = [], contextEntries = [], storyNotes, lastError, blockers } = opts;

    // 1. Post status message
    this.postMessage('STATUS', `[${this.storyId}] iter ${this.iteration} — ${status.toUpperCase()}`, summary);
    console.log(`[FORGE MEMORY] ✓ Status message posted: ${status}`);

    // 2. Record discoveries
    for (const d of discoveries) {
      this.recordDiscovery(d.type, d.title, d.detail);
      console.log(`[FORGE MEMORY] ✓ Discovery recorded: [${d.type}] ${d.title}`);
    }

    // 3. Write context entries
    for (const c of contextEntries) {
      this.setContext(c.key, c.value, c.scope ?? 'global', c.valueType ?? 'text');
      console.log(`[FORGE MEMORY] ✓ Context written: ${c.key}`);
    }

    // 4. Update story state
    this.updateStoryState({
      contextNotes: storyNotes,
      lastError: status === 'pass' ? null : (lastError ?? null),
      blockers: status === 'pass' ? [] : (blockers ?? null),
    });
    console.log('[FORGE MEMORY] ✓ Story state updated');

    // 5. Audit exit
    this.audit('AGENT_EXIT', 'agent_iterations', `status=${status} gate=${gateResult}`);

    console.log('[FORGE MEMORY] ── Exit Protocol Complete ───────────────────────\n');
  }

  // ── READS ────────────────────────────────────────────────

  readStartupReport(reportPath: string = 'forge-startup-report.md'): string {
    if (!existsSync(reportPath)) {
      return '(No startup report found — forge.sh may not have run cleanly)';
    }
    return readFileSync(reportPath, 'utf-8');
  }

  getUnreadMessages(): AgentMessage[] {
    return this.db.prepare(
      `SELECT * FROM agent_messages WHERE read_at IS NULL ORDER BY created_at ASC`
    ).all() as unknown as AgentMessage[];
  }

  getStoryState(storyId: string): StoryState | null {
    const row = this.db.prepare(
      `SELECT *, json(blockers) as blockers FROM story_state WHERE story_id = ?`
    ).get(storyId) as StoryStateRow | undefined;

    if (!row) return null;
    return {
      ...row,
      blockers: row.blockers ? JSON.parse(row.blockers) : null,
    };
  }

  getContextForStory(storyId: string): ContextEntry[] {
    return this.db.prepare(
      `SELECT * FROM context_store
       WHERE scope = 'global' OR scope = ?
       ORDER BY updated_at DESC`
    ).all(`story:${storyId}`) as unknown as ContextEntry[];
  }

  getContext(key: string, scope: string = 'global'): string | null {
    const row = this.db.prepare(
      `SELECT value FROM context_store WHERE key = ? AND scope = ?`
    ).get(key, scope) as { value: string } | undefined;
    return row?.value ?? null;
  }

  getDiscoveriesByStory(storyId: string): Discovery[] {
    return this.db.prepare(
      `SELECT * FROM discoveries WHERE story_id = ? ORDER BY created_at DESC`
    ).all(storyId) as unknown as Discovery[];
  }

  getAllDiscoveries(limit: number = 20): Discovery[] {
    return this.db.prepare(
      `SELECT * FROM discoveries ORDER BY created_at DESC LIMIT ?`
    ).all(limit) as unknown as Discovery[];
  }

  // ── WRITES ───────────────────────────────────────────────

  markMessagesRead(): void {
    this.db.prepare(
      `UPDATE agent_messages SET read_at = datetime('now')
       WHERE read_at IS NULL AND from_session != ?`
    ).run(this.sessionId);
  }

  postMessage(
    type: MessageType,
    subject: string,
    body: string,
    storyId?: string
  ): void {
    this.db.prepare(
      `INSERT INTO agent_messages(from_session, from_iter, story_id, message_type, subject, body)
       VALUES(?, ?, ?, ?, ?, ?)`
    ).run(
      this.sessionId,
      this.iteration,
      storyId ?? this.storyId,
      type,
      subject,
      body
    );
  }

  recordDiscovery(type: DiscoveryType, title: string, detail: string): void {
    this.db.prepare(
      `INSERT INTO discoveries(story_id, session_id, iteration, type, title, detail)
       VALUES(?, ?, ?, ?, ?, ?)`
    ).run(this.storyId, this.sessionId, this.iteration, type, title, detail);
  }

  setContext(
    key: string,
    value: string,
    scope: string = 'global',
    valueType: ContextValueType = 'text'
  ): void {
    this.db.prepare(
      `INSERT INTO context_store(key, scope, value, value_type, written_by, updated_at)
       VALUES(?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(key, scope) DO UPDATE SET
         value = excluded.value,
         value_type = excluded.value_type,
         written_by = excluded.written_by,
         updated_at = datetime('now')`
    ).run(key, scope, value, valueType, `${this.sessionId}-${this.iteration}`);
  }

  updateStoryState(opts: {
    contextNotes?: string | null;
    lastError?: string | null;
    blockers?: string[] | null;
  }): void {
    const { contextNotes, lastError, blockers } = opts;
    this.db.prepare(
      `INSERT INTO story_state(story_id, attempt_count, context_notes, last_error, blockers, last_session, last_updated)
       VALUES(?, 1, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(story_id) DO UPDATE SET
         context_notes = COALESCE(excluded.context_notes, story_state.context_notes),
         last_error    = excluded.last_error,
         blockers      = excluded.blockers,
         last_session  = excluded.last_session,
         last_updated  = datetime('now')`
    ).run(
      this.storyId,
      contextNotes ?? null,
      lastError ?? null,
      blockers ? JSON.stringify(blockers) : null,
      this.sessionId
    );
  }

  // ── AUDIT ────────────────────────────────────────────────

  audit(action: string, entity?: string, detail?: string): void {
    this.db.prepare(
      `INSERT INTO audit_log(session_id, iteration, story_id, action, entity, detail)
       VALUES(?, ?, ?, ?, ?, ?)`
    ).run(
      this.sessionId,
      this.iteration,
      this.storyId,
      action,
      entity ?? null,
      detail ?? null
    );
  }

  // ── UTILITIES ────────────────────────────────────────────

  /**
    * Compile discoveries into markdown sections for history archiving.
    * Archive target files:
    * - /home/spoq/ai-vision/docs/history/forge_history.md
    * - /home/spoq/ai-vision/docs/history/history_index.md
    *
    * Method name is retained for compatibility with older scripts.
   */
  compileAgentsMd(): string {
    const discoveries = this.db.prepare(
      `SELECT * FROM discoveries WHERE exported_to_agents_md = 0 ORDER BY created_at ASC`
    ).all() as unknown as Discovery[];

    if (!discoveries.length) return '';

    const sections = discoveries.reduce<Record<string, Discovery[]>>((acc, d) => {
      acc[d.type] = acc[d.type] ?? [];
      acc[d.type].push(d);
      return acc;
    }, {});

    let md = `\n## Auto-compiled from FORGE Discoveries — ${new Date().toISOString().split('T')[0]}\n\n`;

    for (const [type, items] of Object.entries(sections)) {
      md += `### ${type}S\n`;
      for (const d of items) {
        md += `- **[${d.story_id}] ${d.title}**: ${d.detail}\n`;
      }
      md += '\n';
    }

    // Mark exported
    this.db.prepare(
      `UPDATE discoveries SET exported_to_agents_md = 1 WHERE exported_to_agents_md = 0`
    ).run();

    return md;
  }

  close(): void {
    this.db.close();
  }
}

// ── Standalone CLI helper ─────────────────────────────────
// Usage: npx ts-node forge-memory-client.ts <command> [args]

if (require.main === module) {
  const [,, cmd, ...args] = process.argv;
  const db = new DatabaseSync('forge-memory.db');

  switch (cmd) {
    case 'messages':
      console.log('Unread messages:');
      console.table(
        db.prepare(`SELECT id, message_type, subject, from_session FROM agent_messages WHERE read_at IS NULL`).all()
      );
      break;
    case 'discoveries':
      console.log('Recent discoveries:');
      console.table(
        db.prepare(`SELECT type, title, story_id, created_at FROM discoveries ORDER BY created_at DESC LIMIT 20`).all()
      );
      break;
    case 'context':
      console.log('Context store:');
      console.table(
        db.prepare(`SELECT key, scope, value, written_by FROM context_store ORDER BY updated_at DESC`).all()
      );
      break;
    case 'stories':
      console.log('Story state:');
      console.table(
        db.prepare(`SELECT story_id, attempt_count, last_error, last_updated FROM story_state`).all()
      );
      break;
    case 'audit': {
      const storyFilter = args[0];
      const rows = storyFilter
        ? db.prepare(`SELECT action, entity, detail, ts FROM audit_log WHERE story_id=? ORDER BY ts`).all(storyFilter)
        : db.prepare(`SELECT session_id, story_id, action, ts FROM audit_log ORDER BY ts DESC LIMIT 30`).all();
      console.table(rows);
      break;
    }
    default:
      console.log('forge-memory-client CLI\nCommands: messages | discoveries | context | stories | audit [story-id]');
  }

  db.close();
}
