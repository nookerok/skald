# ADR 0003 — Multi-World Persistence

## Context

Skald currently has one global Event Log in a single SQLite database. The
browser shows a technical panel over this single world. There is no main menu,
no save management, and no path to multiple independent worlds.

Two approaches were considered:

1. One SQLite file per world (separate DBs)
2. One SQLite database with `world_id`-scoped tables

## Decision

Option 2 — single SQLite database with `world_id` isolation — was chosen.

### Why single database

- Event batch and idempotency key stay in one atomic transaction.
- World creation + initial Event Log can be committed atomically.
- Existing backup/restore operates on a single consistent artifact.
- No orphaned world files if creation is interrupted.
- No separate manifest or complex multi-file rollback.
- SQLite performance is sufficient for a single-user Orange Pi deployment.

### Isolation model

- `world_id` is an infrastructure wrapper around the canonical Domain Event.
  It is NOT part of the Domain Event schema (§2.1 of spec).
- SQLite rows: `world_id + canonical Domain Event fields`.
- `UNIQUE (world_id, event_id)` — same event ID allowed across worlds.
- `UNIQUE (world_id, idempotency_key)` — same key allowed across worlds.
- Replay: `WHERE world_id = ? ORDER BY seq`.

### World = Save slot

In UX-4.0, `WorldId` IS the save slot. There is no separate `SaveSlot` entity.
Each world has its own Event Log, Projection, and persistence.

### Character model

One character per world. A different character creates a different world.
Character profile (wound, promise, principle) is snapshotted into the world
at creation time to ensure historic immutability.

### Autosave only

Successful top-level commands already commit atomically — that IS the save.
No `SaveRequested` / `GameSaved` Domain Events needed.

## Consequences

- Migration v1 → v2 converts the existing production database.
- New `worlds` table for WorldRecord (metadata, not game state).
- New `character_profiles` table.
- `events` and `processed_requests` tables gain `world_id` foreign key.
- `WorldRuntimeManager` loads/replays individual worlds on demand.
- All game APIs become scoped to `GET /api/worlds/:worldId/...`.
- Main Menu UI replaces the current direct-game-screen entry.
