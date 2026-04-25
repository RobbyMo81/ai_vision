import { DatabaseSync } from 'node:sqlite';

export * from '../../ForgeMP/forge-memory-client';

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
