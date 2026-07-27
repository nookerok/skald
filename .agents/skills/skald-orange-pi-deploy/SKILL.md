---
name: skald-orange-pi-deploy
description: Safely install, update, verify, smoke-test, or roll back the Skald always-on server on its Orange Pi. Use for Skald deployment requests, Orange Pi service checks, production health verification, post-deploy gameplay smoke tests, backup/restore, or rollback. The canonical target is nooker@192.168.0.5.
---

# Skald Orange Pi Deploy

Deploy only the Skald repository. Treat `AGENTS.md` section “Orange Pi
Deployment Rule” and `packages/cli/deploy/README.md` as authoritative.

## Fixed target

- SSH: `nooker@192.168.0.5`
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
   ssh nooker@192.168.0.5 \
     'hostname; whoami; test -d /home/nooker/skald; \
      git -C /home/nooker/skald status --short --branch; \
      systemctl is-active skald.service'
   ```

   If authentication fails, stop. Do not guess passwords, users, or keys.

3. Run the installed updater as `nooker`, never through external `sudo`:

   ```bash
   ssh nooker@192.168.0.5 /usr/local/bin/update-orange-pi.sh
   ```

   The updater owns backup, SQLite integrity, fast-forward pull, exact Node
   selection, dependency install, tests, restart, and its health gate.

4. Confirm the deployed commit and services:

   ```bash
   ssh nooker@192.168.0.5 \
     'git -C /home/nooker/skald rev-parse HEAD; \
      systemctl is-active skald.service \
      skald-healthcheck.timer skald-backup.timer; \
      curl --fail --silent http://127.0.0.1:3000/api/health; echo; \
      curl --fail --silent http://127.0.0.1:3000/api/state; echo'
   ```

   Require the remote commit to equal the pushed commit.

## Install workflow

Use installation only when `/home/nooker/skald` or the systemd deployment is
absent. Read `packages/cli/deploy/README.md`, then run from the remote clone:

```bash
packages/cli/deploy/install-orange-pi.sh
```

Never invoke the installer with external `sudo`.

## Ten-turn smoke test

An API smoke test changes the canonical world by ten turns. Run it only as part
of an authorized deployment check. Send ten sequential `POST /api/command`
requests with unique idempotency keys and a mix of movement, wait, and social
actions. For every response require:

- HTTP 200;
- `ok: true`;
- non-null `presentation.primary`;
- `state` present;
- world time increasing by exactly one.

After turn ten, require `/api/health` HTTP 200 and `/api/state` to match the last
response. Re-send one completed request with the same key and require HTTP 409.

For visual QA, open `http://192.168.0.5:3000` and actually click ten controls.
Confirm primary/notable rendering, disabled controls while pending, retry,
collapsed diagnostics, and persistence after reload. If a real browser run is
unavailable, report API smoke success separately and never claim visual QA.

## Failure handling

- Do not declare success before commit, service, health, state, and smoke gates.
- On updater failure, preserve its printed previous commit and backup path.
- Inspect `journalctl -u skald.service -n 100 --no-pager`.
- Use `/usr/local/bin/restore-skald.sh` for database restoration.
- Perform rollback only against the verified clean remote repository and the
  exact previous commit recorded by the updater.
- Never expose this unauthenticated server outside the trusted LAN.
