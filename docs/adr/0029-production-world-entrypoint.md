# ADR-0029: Production world entrypoint and Pilot Region cutover

Status: accepted

## Context

The production save named `legacy-world` predates the spatial region slice. It
is a valid event-sourced world, but it has no `RegionDefined` bootstrap, no
observer location and no reveal geometry. Rendering the Pilot Region artwork
over that save would be presentation-only and would misrepresent the player's
world.

The compiled `living_region` template already creates the Pilot Region
bootstrap. Production therefore needs an explicit, reversible entrypoint to a
new isolated world rather than an in-place rewrite of the legacy Event Log.

## Decision

1. Keep each world's Event Log immutable. A cutover creates a new world from
   the deterministic `living_region` bootstrap (`riverwatch-basin`).
2. Add SQLite schema v6 with two operational read-side tables:
   - `world_entrypoints`: the `primary` world selected by `/api/continue` and
     unscoped gameplay endpoints;
   - `world_successions`: an explicit `from -> to` replacement relation.
3. The cutover is executed by `npm run world:cutover`. It is dry-run by
   default and requires `--apply` for writes. The operation is idempotent by a
   stable creation idempotency key, verifies the observer map, and never
   archives or edits the source world.
4. Requests to a superseded world return HTTP 410 with
   `replacementWorldId`. The browser redirects stale direct/presence routes to
   the replacement world's presence entry.
5. `legacy-world` remains the compatibility fallback when no primary entrypoint
   exists. This preserves fresh installs and rollback safety.

## Consequences

- A production player can enter a world whose runtime projection contains the
  Pilot Region, current location and observer-scoped reveal area.
- The legacy Event Log remains replayable and can be retained for rollback or
  historical inspection.
- Deployment must migrate SQLite to v6 before applying the cutover. The
  Orange Pi workflow still requires backup, integrity check, fast-forward
  update, health and idempotent smoke verification.
- Primary selection is infrastructure, not a Domain Event and never changes
  simulation authority.

## Verification

The implementation has migration, persistence, cutover and HTTP routing tests.
`npm run validate` is the release gate; it covers typecheck, all tests, Canon,
simulation, evaluation and diff checks.
