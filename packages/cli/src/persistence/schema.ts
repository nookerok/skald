export const USER_VERSION = 8;

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
  db.exec(`PRAGMA user_version = 4`);

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

export function execSchemaV5(db: { exec(sql: string): void }): void {
  execSchemaV4(db);
  db.exec(`PRAGMA user_version = 5`);

  // Non-authoritative literary narration (ADR-0024 "МИР" voice), keyed per turn.
  // This is a read-side journal decoration, never part of the Event Log.
  db.exec(`CREATE TABLE IF NOT EXISTS turn_narrations (
    world_id      TEXT NOT NULL,
    world_time    INTEGER NOT NULL,
    text          TEXT NOT NULL,
    model         TEXT NOT NULL,
    used_fallback INTEGER NOT NULL,
    latency_ms    INTEGER NOT NULL,
    FOREIGN KEY (world_id) REFERENCES worlds(world_id),
    PRIMARY KEY (world_id, world_time)
  ) STRICT`);
}


export function execSchemaV6(db: { exec(sql: string): void }): void {
  execSchemaV5(db);
  db.exec(`PRAGMA user_version = 6`);
  db.exec(`CREATE TABLE IF NOT EXISTS world_entrypoints (
    entrypoint TEXT PRIMARY KEY CHECK (entrypoint = 'primary'),
    world_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (world_id) REFERENCES worlds(world_id)
  ) STRICT`);
  db.exec(`CREATE TABLE IF NOT EXISTS world_successions (
    from_world_id TEXT PRIMARY KEY,
    to_world_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (from_world_id) REFERENCES worlds(world_id),
    FOREIGN KEY (to_world_id) REFERENCES worlds(world_id),
    CHECK (from_world_id <> to_world_id)
  ) STRICT`);
}

/** Latest schema for fresh databases. Entrypoint metadata is additive and is
 * not a source of current world truth; the Event Log remains authoritative. */
export function execSchemaV7(db: { exec(sql: string): void }): void {
  execSchemaV6(db);
  db.exec("ALTER TABLE worlds ADD COLUMN entrypoint_id TEXT");
  db.exec("PRAGMA user_version = 7");
}


/** Latest additive migration: persist the selected background identity. */
export function execSchemaV8(db: { exec(sql: string): void }): void {
  execSchemaV7(db);
  db.exec("ALTER TABLE character_profiles ADD COLUMN background_id TEXT");
  db.exec("PRAGMA user_version = 8");
}
