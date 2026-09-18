-- Compatibility storage: preserves all existing JSON records and absolute TTLs.
-- The admin migration tool creates this schema too. Do not mark migration ready manually.
CREATE TABLE IF NOT EXISTS filmwork_records (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS filmwork_records_expiry
  ON filmwork_records(expires_at) WHERE expires_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS filmwork_migration (
  id INTEGER PRIMARY KEY CHECK(id=1),
  state TEXT NOT NULL
);
