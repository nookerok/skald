export const USER_VERSION = 4;

export function configureDatabase(db: { exec(sql: string): void }): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
}

export function execSchemaV2(db: { exec(sql: string): void }): void {
  db.exec(`PRAGMA user_version = 2`);

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

export function execSchemaV3(db: { exec(sql: string): void }): void {
  execSchemaV2(db);
  db.exec(`PRAGMA user_version = 3`);

  db.exec(`CREATE TABLE IF NOT EXISTS world_creation_requests (
    idempotency_key TEXT PRIMARY KEY,
    request_hash    TEXT NOT NULL,
    world_id        TEXT NOT NULL UNIQUE,
    created_at      INTEGER NOT NULL,
    FOREIGN KEY (world_id) REFERENCES worlds(world_id)
  ) STRICT`);
}

export function execSchemaV4(db: { exec(sql: string): void }): void {
  execSchemaV3(db);
  db.exec(`PRAGMA user_version = ${USER_VERSION}`);

  db.exec(`CREATE TABLE IF NOT EXISTS observer_checkpoints (
    world_id                   TEXT NOT NULL,
    observer_id                TEXT NOT NULL,
    last_presence_world_time   INTEGER NOT NULL,
    last_presence_event_number INTEGER NOT NULL,
    belief_revision            INTEGER NOT NULL,
    updated_at                 INTEGER NOT NULL,
    FOREIGN KEY (world_id) REFERENCES worlds(world_id),
    PRIMARY KEY (world_id, observer_id)
  ) STRICT`);

  db.exec(`CREATE TABLE IF NOT EXISTS acknowledge_requests (
    world_id                   TEXT NOT NULL,
    idempotency_key            TEXT NOT NULL,
    request_hash               TEXT NOT NULL,
    correlation_id             TEXT NOT NULL,
    changed                    INTEGER NOT NULL,
    last_presence_world_time   INTEGER NOT NULL,
    last_presence_event_number INTEGER NOT NULL,
    belief_revision            INTEGER NOT NULL,
    updated_at                 INTEGER NOT NULL,
    FOREIGN KEY (world_id) REFERENCES worlds(world_id),
    PRIMARY KEY (world_id, idempotency_key)
  ) STRICT`);
}
