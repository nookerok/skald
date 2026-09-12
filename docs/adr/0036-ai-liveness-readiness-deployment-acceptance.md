# ADR-0036: AI liveness, readiness and deployment acceptance

## Context

Skald has two independent operational concerns: the event-sourced simulation
must stay alive even when an external model provider is unavailable, while a
production update must not be called accepted until the configured Intent and
Narration routes have been exercised successfully. Treating an AI outage as
`/api/health` failure makes systemd restart a healthy simulation and does not
prove that the deployed AI configuration works.

## Decision

Skald exposes three distinct states:

- **Simulation liveness**: the world can be loaded, the Event Log is readable,
  and Projection is healthy. `GET /api/health` reports this state only.
- **AI readiness**: a no-world, read-only probe verifies candidates selected
  from the authenticated OpenCode Zen catalogue. Startup fetches
  `/zen/v1/models`, probes every preferred model once for both routes, and
  exposes only candidates that are present, credential-accessible and
  probe-valid. The first two valid candidates are reported as active and
  backup; every other candidate has a sanitized exclusion reason.
- **Deployment acceptance**: an operational update is accepted only after
  liveness is healthy and the AI readiness probe returns `ready`.

Deployment endpoint identity is a separate precondition. The local target
preflight checks `GET http://192.168.0.5:3000/api/health` independently from
five independent sessions of `ssh -i /home/nook/.ssh/id_ed25519_skald
nooker@192.168.0.5`. A healthy HTTP response does not prove that SSH reaches the
Orange Pi, and a single lucky SSH session does not prove a stable port-forward.
When HTTP is `200` but any SSH session reaches another identity or the canonical
repository/data/service checks fail, the preflight state is
`HTTP_ALIVE_SSH_IDENTITY_MISMATCH` and deployment is blocked. No alternate user,
path or endpoint is substituted silently.

The readiness probe is a read-side operation. It receives no `worldId`, player
text or idempotency command; it does not read or mutate the Event Log,
Projection, game time, ConversationTurn or narration tables. Probe prompts and
responses are never returned in the report.

AI failure does not make simulation liveness unhealthy. Deterministic fallbacks
remain available to players, but an updater must return a non-zero exit status
and must not print a success message until readiness is `ready`.

Operational diagnostics are bounded, sanitized and kept outside player-facing
state, journals and conversation transcripts. The loopback-only
`POST /api/ops/ai-probe` endpoint may execute one probe at a time and returns
HTTP 200 only for `ready`; all other readiness states return HTTP 503. A cached
readiness report may be exposed without invoking a provider.

## Amendment (2026-09-12): `degraded` is accepted for deployment

Since 2026-09-09 production runs a single probe-valid model (Ollama Cloud
fallback): the Zen free tier is server-side locked out of non-app sessions,
OpenRouter stays idle by design while earlier providers answer, and the
keyless `opencode_run` candidate is a narrate-only backup. `ready` (two valid
candidates on both routes) is therefore unreachable by architecture, not by
outage — demanding it blocks every future deploy without making the game
safer. Deployment acceptance now accepts `ready` or `degraded` and fails only
on `unavailable`, `misconfigured` or an unparsable probe. The endpoint
contract is unchanged (HTTP 200 iff `ready`); the installer and updater parse
`readiness.status` from the sanitized body instead of gating on the status
code. Everything else in this ADR still stands.

## Consequences

The same provider configuration factory is used by gameplay, Intent, Narration
and readiness. Production requires a valid OpenCode Zen credential and two
probe-ready candidates when `SKALD_AI_REQUIRED=1`; local tests may explicitly
use `0`. The healthcheck timer continues to monitor liveness only and never
restarts Skald for a model timeout, rate limit or other external AI error.
