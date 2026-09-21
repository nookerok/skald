---
name: skald-orange-pi-deploy
description: Safely install, update, verify, smoke-test, or roll back the Skald always-on server on its Orange Pi. Use for Skald deployment requests, Orange Pi service checks, production health verification, post-deploy gameplay smoke tests, backup/restore, or rollback. The canonical target is nooker@192.168.0.5.
---

# Skald Orange Pi Deploy

Deploy only the Skald repository. Treat `AGENTS.md` section “Orange Pi
Deployment Rule” and `packages/cli/deploy/README.md` as authoritative.

## Fixed target

- SSH: `nooker@192.168.0.5`
- SSH key: `/home/nook/.ssh/id_ed25519_skald`
- Repository: `/home/nooker/skald`
- Data: `/home/nooker/skald-data`
- Service: `skald.service`
- Local API: `http://127.0.0.1:3000`
- LAN UI/API: `http://192.168.0.5:3000`
- Node: `/home/nooker/.nvm/versions/node/v22.23.1/bin/node`

Do not rediscover or guess the target while these values remain current. Before
the first mutation in a session, still verify `whoami`, repository presence,
branch, cleanliness, and service identity. Abort on any mismatch.

## Update workflow

1. In the local workspace, verify:

   ```bash
   git status --short --branch
   npm run validate
   git rev-parse HEAD
   git rev-parse origin/main
   ```

   Require a clean `main` and equal local/remote commits.

2. Verify the remote without changing it:

   ```bash
   ssh -i /home/nook/.ssh/id_ed25519_skald nooker@192.168.0.5 \
     'hostname; whoami; test -d /home/nooker/skald; \
      git -C /home/nooker/skald status --short --branch; \
      systemctl is-active skald.service'
   ```

   If authentication fails, stop. Do not guess passwords, users, or keys.

3. Confirm the installer-managed restricted restart permission before mutation:

   ```bash
   ssh -i /home/nook/.ssh/id_ed25519_skald nooker@192.168.0.5 \
     'sudo -n -l /usr/bin/systemctl restart skald.service'
   ```

   This policy grants `nooker` only the ability to restart `skald.service`.
   If it is missing, stop and run the installer interactively once.

4. Run the installed updater as `nooker`, never through external `sudo`:

   ```bash
   ssh -i /home/nook/.ssh/id_ed25519_skald \
     nooker@192.168.0.5 /usr/local/bin/update-orange-pi.sh
   ```

   The updater owns backup, SQLite integrity, fast-forward pull, exact Node
   selection, dependency install, tests, restart, and its health gate.

5. Confirm the deployed commit, services and current world state:

   ```bash
   ssh -i /home/nook/.ssh/id_ed25519_skald nooker@192.168.0.5 \
     'git -C /home/nooker/skald rev-parse HEAD; \
      systemctl is-active skald.service \
      skald-healthcheck.timer skald-backup.timer; \
      curl --fail --silent http://127.0.0.1:3000/api/health; echo; \
      curl --fail --silent http://127.0.0.1:3000/api/worlds; echo; \
      worldId=$(curl --fail --silent http://127.0.0.1:3000/api/continue \
        | sed -n "s/.*\"worldId\":\"\([^\"]*\)\".*/\1/p"); \
      echo "current world: ${worldId}"; \
      curl --fail --silent "http://127.0.0.1:3000/api/worlds/${worldId}/state"; echo'
   ```

   Require the remote commit to equal the pushed commit.

   `GET /api/health` is liveness only. The unscoped `GET /api/state` maps to the
   primary world (`store.getPrimaryWorldId() ?? "legacy-world"`), so a
   deployment that has several worlds and no primary answers `404
   world_not_found: legacy-world` — a routing default, not a simulation
   failure. Resolve the current world with `GET /api/continue` (the primary when
   it is active, otherwise the most recently played active world) and require
   the scoped `GET /api/worlds/<worldId>/state` to return 200. Do not assign a
   primary world just to satisfy a check: a no-primary multi-world deployment is
   valid and is verified through the world catalog plus the scoped state.

   The updater/installer also run the loopback live intent/narration contract
   probe (`/api/ops/intent-probe`, read-only, no world mutation). A failure is
   an incomplete deployment. To check manually:

   ```bash
   curl -fsS -X POST -H 'Content-Type: application/json' -d '{}' \
     http://127.0.0.1:3000/api/ops/intent-probe
   ```

   or run `npm run acceptance:intent:contract` locally against the configured
   providers.

## Install workflow

Use installation only when `/home/nooker/skald` or the systemd deployment is
absent, or once after upgrading an older installation that lacks the restricted
restart policy. Read `packages/cli/deploy/README.md`, then run interactively from the remote clone:

```bash
packages/cli/deploy/install-orange-pi.sh
```

Never invoke the installer with external `sudo`.

## Ten-turn smoke test

An API smoke test changes a canonical world by ten turns. Run it only as part
of an authorized deployment check, and only against a scratch world created for
the check (`POST /api/worlds`), never an existing player world. Send ten
sequential `POST /api/worlds/<scratchWorldId>/command` requests with unique
idempotency keys and a mix of movement, wait, and social actions. For every
response require:

- HTTP 200;
- `ok: true`;
- non-null `presentation.primary`;
- `state` present;
- world time increasing by exactly one.

After turn ten, require `/api/health` HTTP 200 and the scratch world's scoped
`GET /api/worlds/<worldId>/state` to match the last response. Then check
idempotency against a completed turn's key:

- the SAME body replayed under the SAME key answers HTTP 200 with
  `replayed: true` and creates no second Event;
- a DIFFERENT body under the SAME key answers HTTP 409
  `idempotency_conflict`.

Do not expect 409 from a same-body replay: 409 is the conflict signal for a
reused key with changed input, not the normal duplicate path.

For visual QA, invoke `$skald-ntfs-browser-qa`; the WSL repository task is not
the browser execution surface. Send the deployed commit, current world time,
authorized click budget and exact assertions to the fixed NTFS task. Confirm
primary/notable rendering, disabled controls while pending, retry, collapsed
diagnostics, and persistence after reload. If that real browser run is
unavailable, report API smoke success separately and visual QA as BLOCKED.

## Failure handling

- Do not declare success before commit, service, health, state, and smoke gates.
- On updater failure, preserve its printed previous commit and backup path.
- Inspect `journalctl -u skald.service -n 100 --no-pager`.
- Use `/usr/local/bin/restore-skald.sh` for database restoration.
- Perform rollback only against the verified clean remote repository and the
  exact previous commit recorded by the updater.
- Never expose this unauthenticated server outside the trusted LAN.
