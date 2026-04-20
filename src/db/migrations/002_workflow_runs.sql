CREATE TABLE IF NOT EXISTS workflow_runs (
  session_id          TEXT PRIMARY KEY,
  workflow_id         TEXT NOT NULL,
  workflow_name       TEXT NOT NULL,
  success             INTEGER NOT NULL DEFAULT 0,
  result_json         TEXT NOT NULL,
  state_json          TEXT,
  short_term_json     TEXT,
  scratch_pad_markdown TEXT,
  sic_trigger_json    TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_metadata (
  workflow_id   TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  domain        TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (workflow_id, domain)
);
