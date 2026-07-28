export const USER_VERSION = 2;

export function execSchemaV2(db: { exec(sql: string): void }): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`PRAGMA user_version = ${USER_VERSION}`);

  db.exec(`CREATE TABLE IF NOT EXISTS character_profiles (
    character_id   TEXT PRIMARY KEY,
    display_name   TEXT NOT NULL,
    wound          TEXT NOT NULL,
    promise        TEXT NOT NULL,
    principle      TEXT NOT NULL,
    profile_version INTEGER NOT NULL,
    created_at     INTEGER NOT NULL
  ) STRICT`);

  db.exec(`CREATE TABLE IF NOT EXISTS worlds (
    world_id                TEXT PRIMARY KEY,
    save_label              TEXT NOT NULL,
    template_id             TEXT NOT NULL,
    character_id            TEXT,
    character_name_snapshot TEXT,
    status                  TEXT NOT NULL
        CHECK (status IN ('active', 'archived', 'corrupt')),
    created_at              INTEGER NOT NULL,
    last_played_at          INTEGER
  ) STRICT`);

  db.exec(`CREATE TABLE IF NOT EXISTS events (
    seq            INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id       TEXT NOT NULL,
    event_id       TEXT NOT NULL,
    type           TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    payload_json   TEXT NOT NULL,
    timestamp      INTEGER NOT NULL,
    causation_id   TEXT,
    correlation_id TEXT,
    FOREIGN KEY (world_id) REFERENCES worlds(world_id),
    UNIQUE (world_id, event_id)
  ) STRICT`);

  db.exec("CREATE INDEX IF NOT EXISTS events_world_seq ON events(world_id, seq)");
  db.exec("CREATE INDEX IF NOT EXISTS events_world_time ON events(world_id, timestamp)");

  db.exec(`CREATE TABLE IF NOT EXISTS processed_requests (
    world_id        TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_kind    TEXT NOT NULL,
    correlation_id  TEXT NOT NULL,
    FOREIGN KEY (world_id) REFERENCES worlds(world_id),
    PRIMARY KEY (world_id, idempotency_key)
  ) STRICT`);
}
