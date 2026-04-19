CREATE TABLE IF NOT EXISTS telemetry_events (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  level           TEXT NOT NULL,
  source          TEXT NOT NULL,
  session_id      TEXT,
  workflow_id     TEXT,
  step_id         TEXT,
  duration_ms     INTEGER,
  details_json    TEXT NOT NULL,
  issue_code      TEXT,
  issue_severity  TEXT,
  issue_message   TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_created_at
  ON telemetry_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_issue
  ON telemetry_events (issue_severity, created_at DESC);
