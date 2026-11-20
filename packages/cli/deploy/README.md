# Skald Orange Pi Deployment

## Prerequisites

- Orange Pi 4 LTS (aarch64)
- Armbian or Ubuntu 22.04+
- Node.js 22.23.1 (via nvm)
- SQLite3 CLI

## Quick Install

```bash
cd /home/nooker
git clone https://github.com/nookerok/skald.git
cd skald

source ~/.nvm/nvm.sh
nvm install 22.23.1
nvm use 22.23.1

npm ci
npm run typecheck
npm test -- --run

chmod +x packages/cli/deploy/*.sh
packages/cli/deploy/install-orange-pi.sh
```

The install script will:
1. Verify prerequisites (including exact Node v22.23.1 binary)
2. Run build and tests
3. Create `/home/nooker/skald-data` and backups directory
4. Install a restricted sudoers rule for restarting only `skald.service`
5. Install helper scripts to `/usr/local/bin/`
6. Install systemd units
7. Start the server and wait for simulation liveness
8. Require `SKALD_AI_REQUIRED=1`, run the loopback AI readiness probe, and
   refuse installation completion when readiness is `unavailable`,
   `misconfigured`, unparsable or not `playable` (both routes need a live
   candidate; `ready` or `degraded` are accepted)
9. Enable health check, backup and AI-discovery timers

The installer creates `skald.env` from the example on first run. Set
`SKALD_AI_REQUIRED=1` and add the OpenCode Zen key before rerunning it; `0` is
reserved for local/test environments and cannot produce an Orange Pi success
banner. The server fetches the live Zen catalogue at startup and probes every
preferred model for both routes before selecting active and backup models.

## Target preflight

Before any commit, push or updater invocation, run the local read-only target
preflight:

```bash
packages/cli/deploy/preflight-orange-pi.sh
```

It performs two independent checks:

1. `GET http://192.168.0.5:3000/api/health` checks HTTP simulation liveness.
2. `ssh -i /home/nook/.ssh/id_ed25519_skald nooker@192.168.0.5` checks
   `hostname`, `whoami`, `uname -a`, `/home/nooker/skald`,
   `/home/nooker/skald-data` and `systemctl is-active skald.service`.

The canonical command is:

```bash
ssh -i /home/nook/.ssh/id_ed25519_skald nooker@192.168.0.5 \
  'hostname; whoami; uname -a; \
   test -d /home/nooker/skald; \
   test -d /home/nooker/skald-data; \
   systemctl is-active skald.service'
```

The SSH check is repeated in five independent sessions. This catches a
port-forward or NAT that alternates between the Orange Pi and another host;
every observed session must match the canonical identity.

HTTP 200 does not identify the machine behind the HTTP endpoint. If HTTP is
alive but SSH reaches the wrong user/host or the canonical paths/service do not
match, the script returns `HTTP_ALIVE_SSH_IDENTITY_MISMATCH`, prints
`Preflight: BLOCKED` and exits non-zero. It never substitutes another user or
path and never runs commit, push, updater, restart or migrations.

The only deployable identity is `nooker` with repository
`/home/nooker/skald`, data `/home/nooker/skald-data` and active
`skald.service`.

> **Do not run install-orange-pi.sh with sudo.** It refuses root. Only `systemctl` and file copies inside the script use sudo.

## Configuration

AI provider keys and the production acceptance policy go in `/home/nooker/skald-data/skald.env`:
```
SKALD_OPENCODE_ZEN_API_KEY=your_key_here
# Optional legacy provider key; it is not a live Zen candidate.
SKALD_OLLAMA_CLOUD_API_KEY=
# Optional last-resort provider key (sk-or-v1-...); probed only when Zen and
# Ollama Cloud both activate nothing.
SKALD_OPENROUTER_API_KEY=
SKALD_AI_REQUIRED=1
# Optional local-subprocess narrative transport (off by default; narrate-route
# backup only). Requires the containment `narrative` agent on the host. The
# service PATH includes `/home/nooker/bin`; `SKALD_OPENCODE_BIN` can pin an
# exact binary. See packages/cli/deploy/skald.env.example.
# SKALD_OPENCODE_RUN=1
# SKALD_OPENCODE_BIN=/home/nooker/.opencode/bin/opencode
# OpenCode v2 Server primary transport (off by default; see the section below).
# SKALD_OPENCODE_SERVER_ENABLED=1
# SKALD_OPENCODE_SERVER_MODEL=opencode/<screened-zero-price-model-id>
```

The systemd unit keeps the operator `HOME` read-only. Each `opencode_run` call
uses an empty per-call home under service-private `/tmp` containing only the
repo-pinned tools-denied manifest. The optional v2 server uses a separate
`HOME` and XDG tree under `/home/nooker/skald-data/opencode-server`. The local
OpenCode Server, bound to loopback, creates a fresh, random session
for each generation request; session history is never reused and the session
is removed after the transient generation. OpenCode state is not game memory.
Both transports stay inside the service boundary and never write Skald Events
or Projection. Installer/updater enforce the containment env policy through
the tested `env-policy.ts` before service-affecting steps (updater: before
backup; installer: before units/scripts/agent go in). After changing
`skald.service`, re-install the unit and reload systemd before restarting
(installer step, requires root).

### OpenCode v2 Server primary transport

The server transport uses the official `@opencode/client` SDK pinned to
OpenCode **2.3.0** and binds its private server to `127.0.0.1:4097`. The
installed `/home/nooker/bin/opencode` launcher is expected on the service
`PATH`; `SKALD_OPENCODE_BIN` can pin that exact path. The transport is off
unless all three primary settings are present:

```text
SKALD_OPENCODE_SERVER_ENABLED=1
SKALD_OPENCODE_SERVER_MODEL=opencode/<exact-model-id>
SKALD_OPENCODE_ZEN_API_KEY=<credential>
```

When enabled, the pinned OpenCode candidates are the **only** `interpret` and
`narrate` routes; direct Zen HTTP and unrelated provider failover are removed.
This prevents a failed/rate-limited OpenCode call from silently reaching a
possibly paid provider. An optional `SKALD_OPENCODE_SERVER_FALLBACK_MODEL` may
follow the primary. Both candidates must be active chat models with explicit
prices. Primary and fallback are zero-priced by default. After explicit
operator approval of the model and spending budget, a paid primary requires
`SKALD_OPENCODE_SERVER_ALLOW_PAID_PRIMARY=1`; a paid fallback independently
requires `SKALD_OPENCODE_SERVER_ALLOW_PAID_FALLBACK=1`. Neither permission
authorizes the other slot. The paid fallback opt-in requires a fallback pin
and is rejected by the deploy policy otherwise. These flags are permissions,
not billing caps; configure spending limits with the provider before use.
This runtime price guard is not a quality or availability screen and does not
nominate or activate models from discovery receipts.

For each request the adapter creates a fresh session with a random ID and a
deny-all permission rule, calls the official session.generate transient-text
method, then deletes the session. The transient operation does not append
dialogue history; the session exists only to select the pinned model and
location. Failed cleanup turns the generation into a provider failure rather
than silently retaining server-side conversation state. Tool permissions are
denied both in the isolated OpenCode config and on the session; the adapter
does not call prompt, shell, filesystem, MCP or plugin APIs.

Provider concurrency defaults to two, has a hard maximum of four and a
bounded queue of eight; caller cancellation is propagated and does not
retry/fail over. A 429 is not retried in a hot loop;
the bounded original `Retry-After`, parsed delay, applied cooldown, allowlisted
provider code and sanitized trace ID are kept separate in failure diagnostics.
OpenCode's typed gateway error may wrap an upstream 402/429 in HTTP 502;
diagnostics retain the upstream `httpStatus` and outer `gatewayHttpStatus`
separately. For a model that needs longer live interpretation, explicitly set
`GM_DIRECTOR_LIVE_TIMEOUT_MS` to 1000..30000 milliseconds (default 4000).
This changes only the interpretation budget, not authority or game-time cost.

For free discovery candidates, keep the setting disabled unless a current
scheduled screening pass and the operator's separate task-evaluation decision
exist. A paid route instead needs explicit model/budget approval and a bounded
control generation before live activation. Catalogue presence or a
zero-price marker alone proves neither callability nor safe Russian prose.
The v2 response includes token usage and model-reported cost; the adapter
validates those numeric fields and returns them as usage and reportedCostUsd
(the latter is a provider-reported estimate, not a billing receipt). The live
P3 acceptance runner separately reserves worst-case cost from the pinned
model's explicit catalogue rates and configured token limits before each
model call, and appends that reservation to the operator's budget ledger.
The ledger is ONE operator-owned file passed explicitly through
`SKALD_P3_BUDGET_LEDGER` as an absolute path OUTSIDE any checkout; a
checkout-relative copy forks the accounting and is rejected. Missing
prices, unverified session model identity, failed ledger writes or
exhausted budget block the call before it reaches OpenCode. A paid live
session also requires the proven Director latency floor
(`GM_DIRECTOR_LIVE_TIMEOUT_MS` >= 20000; the 4s default
cuts live multi-clause interpretations mid-flight, and observed slow
generations justify using the full 30000 ceiling). This acceptance
cap is not a production billing cap; provider-side spending limits remain
necessary for paid production use. The default route remains unchanged until
an explicit model pin is approved and configured. The deploy env-policy also
rejects a missing pin/credential, invalid port and alternate server-state path.

The OpenCode Server child runs as the skald.service user with isolated HOME,
XDG config/data/cache/state directories and a generated Basic-auth password
known only to the local adapter. The configured OpenCode credential is passed
only as OPENCODE_API_KEY to that child. The interactive operator's
opencode auth list or HOME does not prove which credential the service uses.
Verify the systemd User and EnvironmentFile path without printing environment
values; never include a key in diagnostics or shell transcripts. GET
/api/health is simulation liveness only. Use a single, intentionally bounded
loopback intent/probe acceptance when verifying actual model access; it may
make provider calls and must not be polled as a health check. On 429, stop
repeated tests, inspect sanitized provider status and Retry-After/applied
cooldown fields, verify provider quota/auth separately, and make at most one
deliberate retry after the reported cooldown. Do not switch free model IDs or
IPs to evade provider limits.

`GET /api/health` is simulation liveness only and never calls a provider.
`POST http://127.0.0.1:3000/api/ops/ai-probe` is loopback-only and returns 200
only when readiness is `ready` (two probe-valid models on both routes). The
JSON report includes `activeModel`, `backupModel` and sanitized exclusion
reasons. Install/update acceptance delegates the verdict to the tested
`packages/cli/deploy/ai-acceptance.ts` helper reading `readiness.status`
and `playable` from that report: it accepts `ready` or `degraded` with both
routes live (one live model serves, deterministic fallback covers the
rest); `unavailable`, `misconfigured`, a dead route or an unparsable probe
fail acceptance. With `SKALD_AI_REQUIRED=0`, deterministic fallback
keeps the server usable but an AI readiness failure is not deployment
acceptance.

`POST http://127.0.0.1:3000/api/ops/intent-probe` is loopback-only, read-only
and never creates a world or writes the Event Log. It runs the plan's three
live phrases ("я осматриваюсь", "подхожу к ограде", "подхожу к ограде и
осматриваю двор, что я вижу?") through the real master-turn gateway plus one
narration round-trip, and returns 200 only when every phrase resolves without a
generic fallback and narration answers. Install/update acceptance delegates the
verdict to the tested `packages/cli/deploy/intent-acceptance.ts` helper reading
`contract.pass`; readiness alone is not enough — a provider that cannot carry a
turn fails the deploy. Run it manually with `npm run acceptance:intent:contract`
(Traycer/opencode sessions can use the same probe as an opt-in check).

## Post-deploy state check (multi-world)

`GET /api/health` proves simulation liveness only. The unscoped
`GET /api/state` maps to `store.getPrimaryWorldId() ?? "legacy-world"`, so a
deployment that holds several worlds and has no primary answers
`404 world_not_found: legacy-world`. That is the routing default, not a
simulation failure, and it must not be "fixed" by assigning a primary world
just for a check.

Resolve the current world the same way the client does, through
`GET /api/continue` (primary when it is active, otherwise the most recently
played active world), then require the scoped state:

```bash
worldId=$(curl --fail --silent http://127.0.0.1:3000/api/continue \
  | sed -n 's/.*"worldId":"\([^"]*\)".*/\1/p')
curl --fail --silent "http://127.0.0.1:3000/api/worlds/${worldId}/state"
```

A no-primary multi-world deployment is valid: verify the world catalog
(`GET /api/worlds` is non-empty) and the scoped `/api/worlds/<worldId>/state`
rather than the unscoped path. A deployment smoke test runs against a scratch
world created for the check, never an existing player world.

## Serving-route refresh and free-model survey

These are two different mechanisms and must not be read as one signal:

- The in-process `DiscoveryRefresher` checks configured serving-route
  candidates and may keep the last known-good selection on failure. It is not
  the free-model catalogue survey and does not prove that the latest check was
  successful. `POST /api/ops/ai-probe` probes currently routed candidates; it
  does not refresh the catalogue.
- The free-model survey reads the public OpenCode catalogue, screens only
  explicit zero-input/zero-output text chat models through the isolated native
  OpenCode CLI, and writes sanitized immutable receipts outside the Event Log.
  It never sends free OpenCode chat to direct HTTP and never changes serving
  routes. Each screening pass is only a smoke check; task-corpus, privacy and
  operator approval are separate.

The survey code configures a persistent systemd timer for daily 04:00
Europe/Moscow. Fresh installs copy and enable it from
`install-orange-pi.sh`. On an existing Orange Pi, the ordinary updater cannot
install systemd units (its restricted sudo permission is only for restarting
`skald.service`); after the code is deployed, activate the timer once by
running this narrow helper interactively as `nooker`, without external sudo:

    packages/cli/deploy/install-ai-discovery.sh

It installs only the AI-discovery service/timer, verifies the timer is enabled
and active, and does not restart `skald.service` or touch SQLite. Until that
helper has run and the scheduled service has completed successfully, the daily
survey is **configured in source, not operationally verified**.

Loopback-only operator polling:

    curl --fail --silent http://127.0.0.1:3000/api/ops/ai-discovery
    curl --fail --silent -X POST -H 'Content-Type: application/json' \
      -H 'Idempotency-Key: unique-manual-run-id-0001' -d '{}' \
      http://127.0.0.1:3000/api/ops/ai-discovery/refresh

Poll the GET endpoint until `discovery.lastAttempt.status` is no longer
`running`; inspect per-candidate `screening` and the report's catalogue digest,
prices, transport restrictions, failures and timestamps. A completed scan does
not mean every candidate passed. The same immutable report can be explicitly
confirmed by POSTing JSON to `/api/ops/ai-discovery/decision` with
`runId`, `reportSha256`, `candidateId` and `decision` set to
`nominate_for_task_evaluation` or `reject`, plus a fresh `Idempotency-Key`.
Nomination returns HTTP 202 and starts a bounded background task-corpus
evaluation. Poll the same GET endpoint's taskEvaluation field; a concurrent
daily scan is serialized by the shared provider lock. The same idempotency
key returns the original evaluation and never activates a route.
The corpus is the deployed Director corpus plus ten fixed Russian
allowed-facts narration tasks. It has a 48-call ceiling and mandatory human
review. No automatic notification is sent; operators poll the API.

Example confirmation (substitute values from the current GET report):

    curl --fail --silent -X POST -H 'Content-Type: application/json' \
      -H 'Idempotency-Key: operator-decision-0001' \
      -d '{"runId":"20261111T010000Z-...","reportSha256":"<sha256>","candidateId":"<catalog-id>","decision":"nominate_for_task_evaluation"}' \
      http://127.0.0.1:3000/api/ops/ai-discovery/decision

Check `systemctl list-timers --all skald-ai-discovery.timer --no-pager` for
scheduled activation and `journalctl -u skald-ai-discovery.service` for the
last execution. API `nextRunAt` is a schedule calculation, not proof that
systemd has the timer installed or enabled.

Manual CLI invocation from the checkout:
`npm run admin:ai-model-discovery -- --trigger=manual`.

The survey uses the isolated OpenCode CLI only when `SKALD_OPENCODE_RUN=1` is
present in `skald.env`; the default is off. A valid OpenCode Console credential
must also be available as `OPENCODE_API_KEY` or
`SKALD_OPENCODE_ZEN_API_KEY`. If disabled or missing, the scheduled attempt is
still recorded as blocked and performs no inference calls. This opt-in also
makes the local-subprocess candidate available to the router, but narration
fallback remains separately disabled unless its own explicit flag is set.

Structured 429 failures receive one bounded retry using Retry-After when the
CLI supplies it. Authentication, account-quota and transport failures open a
provider-wide circuit breaker for the remainder of the run; sanitized failure
codes are retained without the raw upstream response.

## Access

```bash
# Server IP
hostname -I

# From another device on LAN:
# http://<IP>:3000
```

## Managing the Service

```bash
systemctl status skald.service
journalctl -u skald.service -f
sudo systemctl restart skald.service
sudo systemctl stop skald.service
sudo systemctl disable --now skald.service
```

## Updating

```bash
/usr/local/bin/update-orange-pi.sh
```

The update script:
1. Refuses root/sudo
2. Requires the installer-managed non-interactive permission to restart only
   `skald.service`; it fails before backup or pull when the permission is absent
3. Checks for clean working tree (including untracked files)
4. Rejects detached HEAD
5. Creates and verifies a SQLite backup
6. Fetches and merges via `git pull --ff-only`
7. Runs `npm ci` and `npm run validate` (typecheck, full test suite, Canon)
8. Restarts the service
9. Waits up to 60 seconds for simulation liveness
10. Runs the loopback AI readiness probe and feeds the sanitized body to
    the `ai-acceptance.ts` helper (the endpoint answers HTTP 200 only for
    `ready`); it accepts `ready` or `degraded` with both routes live and
    exits non-zero on `unavailable`, `misconfigured`, a dead route or an
    unparsable probe
11. Runs the loopback live intent/narration contract probe and feeds the
    sanitized body to the `intent-acceptance.ts` helper; it exits non-zero
    when the plan's three live phrases do not resolve without a generic
    fallback or narration does not answer, printing `Update complete` only
    after both gates pass

> **Do not run update-orange-pi.sh with sudo.** It refuses root.

## Backup

```bash
# Manual backup
sudo systemctl start skald-backup.service

# Automatic: daily via systemd timer
# Backups stored in /home/nooker/skald-data/backups/
# Retention: 14 days (backup-*.sqlite pattern)
```

### Restore

Use the restore script (recommended):

```bash
sudo /usr/local/bin/restore-skald.sh /home/nooker/skald-data/backups/events-<DATE>.sqlite
```

The script:
1. Verifies backup integrity (`PRAGMA integrity_check`)
2. Stops timers, then services
3. Replaces database and cleans stale WAL/SHM files
4. Starts server and waits for simulation liveness (up to 60 seconds)
5. Re-enables timers only after successful health check

Manual procedure (if script is unavailable):

```bash
# 1. Verify the backup is intact
sqlite3 /home/nooker/skald-data/backups/events-<DATE>.sqlite "PRAGMA integrity_check;"
# Expect: ok

# 2. Stop timers first (prevent concurrent jobs)
sudo systemctl stop skald-backup.timer skald-healthcheck.timer

# 3. Stop services (timer-triggered oneshots + server)
sudo systemctl stop skald-backup.service skald-healthcheck.service
sudo systemctl stop skald.service

# 4. Replace database and remove stale WAL
cp /home/nooker/skald-data/backups/events-<DATE>.sqlite /home/nooker/skald-data/events.sqlite
chown nooker:nooker /home/nooker/skald-data/events.sqlite
chmod 600 /home/nooker/skald-data/events.sqlite
rm -f /home/nooker/skald-data/events.sqlite-wal /home/nooker/skald-data/events.sqlite-shm

# 5. Start server and wait for health
sudo systemctl start skald.service
sleep 2
curl --fail --silent --max-time 5 http://127.0.0.1:3000/api/health || {
  echo "Server did not become healthy. Check: journalctl -u skald.service -n 50"
  exit 1
}

# 6. Only then re-enable timers
sudo systemctl start skald-backup.timer skald-healthcheck.timer
```

## Rollback

If an update fails or the new version has issues:

```bash
cd /home/nooker/skald
git log --oneline -5
git reset --hard <PREVIOUS_COMMIT>
npm ci
sudo systemctl restart skald.service
```

## Firewall

```bash
sudo ufw allow ssh
sudo ufw allow from 192.168.0.0/16 to any port 3000 proto tcp
sudo ufw enable
```

## Important Notes

- **Trusted LAN only.** No authentication, no TLS, no multi-user isolation.
- **Single process.** Do not run multiple Skald instances on the same SQLite.
- **No auto-advancing time.** World time advances only with player commands, `wait`, or `advance N`.
- **Node 22.23.1 required.** `node:sqlite` is experimental and the service hardcodes this path.
- **AI readiness is separate from liveness.** Without a Zen key, the server
  remains usable with deterministic fallback when `SKALD_AI_REQUIRED=0`;
  production acceptance requires readiness `ready` or `degraded` (one live
  model serves, deterministic fallback covers the rest).
