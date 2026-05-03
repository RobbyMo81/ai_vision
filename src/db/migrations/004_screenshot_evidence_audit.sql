CREATE TABLE IF NOT EXISTS screenshot_evidence_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_id     TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  workflow_id     TEXT,
  step_id         TEXT,
  action          TEXT NOT NULL,
  actor           TEXT NOT NULL,
  reason          TEXT,
  screenshot_path TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(action IN ('reviewed', 'retained', 'pending_deletion', 'deleted', 'delete_failed', 'rejected', 'exported'))
);

CREATE INDEX IF NOT EXISTS idx_screenshot_evidence_audit_evidence_id
  ON screenshot_evidence_audit (evidence_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_screenshot_evidence_audit_session_id
  ON screenshot_evidence_audit (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS screenshot_cleanup_failures (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  screenshot_path TEXT NOT NULL,
  session_id      TEXT,
  workflow_id     TEXT,
  step_id         TEXT,
  class           TEXT,
  retention       TEXT,
  action          TEXT NOT NULL,
  error           TEXT NOT NULL,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'retryable',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(status IN ('retryable', 'dead_letter', 'resolved'))
);

CREATE INDEX IF NOT EXISTS idx_screenshot_cleanup_failures_status
  ON screenshot_cleanup_failures (status, updated_at);
