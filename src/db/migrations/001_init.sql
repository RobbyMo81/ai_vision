CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  engine      TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  success     INTEGER NOT NULL DEFAULT 0,
  output      TEXT,
  error       TEXT,
  duration_ms INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_screenshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  path        TEXT NOT NULL,
  taken_at    TEXT NOT NULL
);
