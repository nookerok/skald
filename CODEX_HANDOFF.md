# Current work (2026-09-12 — residuals fixed, deployed, one root cp pending)

- Fixed all three residual defects (`df7caeb`): helper reads nested
  `readiness.playable` + endpoint-to-helper integration test (the old unit
  fixtures repeated the wrong shape — now pinned against drift); provider
  serves construction-time manifest bytes (A-then-B test proves no checkout
  re-read); env-policy helper parses the systemd subset with behavioral
  matrix (quoted, duplicates, malformed), scripts delegate to it. Gate PASS.
- Deployed `df7caeb`: on-device suite PASS, manifest installed
  post-validation (log line observed), helper gate accepted degraded +
  playable, exit 0. Remote `main` == `origin/main` == `df7caeb`.
- Live probe after deploy: `playable:true`, Ollama ok, but `opencode_run`
  timed out (25-30s) in an ongoing external slow episode. Exonerated the
  unit again: shell control with identical isolated HOME (no systemd) took
  31s wall with 1418 reasoning tokens; idle box, fast egress. Typical ~21s
  stays inside the 25s budget; slow episodes fail closed by design (backup
  drops, template covers) — no budget chase. No orphans (isolated db
  removed with its dir).
- Open: root re-copy of the updater only (helper/env-policy/reorder lines;
  no restart — unit unchanged since last sync); session-row pruning;
  item 6 (legacy DTO/ladder) and item 7 (gameplay run) still deferred;
  canonical world untouched (no gameplay turns this session).

# Previous session (2026-09-12 — residual hardening verified live; CLOSED)

- All five residual items live in prod (`5eadc29`, service healthy): tested
  gate helper, env containment gates, atomic manifest install, skald-data-only
  unit, manifest-aware fingerprint. Installed updater + unit re-synced by
  root (both diff-clean), `validate` PASS throughout.
- Decisive P2 proof got complicated, then resolved: the first probe under the
  tightened unit timed out (25s), and so did the re-probe — with Ollama also
  10x slow (6.6s) on an idle box with fast egress (0.45s). Control experiment
  outside systemd (same isolated HOME, shell env) took 56s to PONG with 2223
  reasoning tokens: the episode is external free-tier model slowness, not the
  unit. Typical roundtrip stays ~20-22s inside the 25s budget; slow episodes
  fail closed by design (backup drops, template fallback covers) — no budget
  chase. Orphan session from the control run never touched the real db
  (isolated HOME removed with its dir).
- Deliberately deferred: item 6 (legacy memory DTO, ladder simplification)
  and item 7 (gameplay replica run — still needs an authorized budget; no
  gameplay turns this session, canonical world untouched at T32/event 469).
- Open: session-row pruning observation; hanging-primary budget trade-off.
- Deployed `28f6ae1` via updater: on-device suite PASS, restart + health PASS,
  but the AI gate FAILED on curl timeout at 30s — the installed updater still
  carried the old curl budget (synced before the 60s fix) while Ollama stalled
  again, pushing the probe past 30s. No rollback: the service is healthy on
  the new code and the failure was environmental (stale budget + transient
  stall), exactly the case the guidance exempts. The installed updater needs
  one more root re-copy (curl-60 line only, no restart).
- Live verification on the final code: `playable:true`,
  `routeStatus:{interpret:ok,narrate:ok}`, Ollama ok ~0.6-0.7s,
  `opencode_run` ok ~21s, modelSelection routes include the backup,
  fingerprint rotated. Ollama flapped twice today (~11:29-11:33,
  ~12:21-deploy-window; egress/DNS verified fine, self-recovered) —
  external provider-side stalls.
- Deliberately deferred: item 6 (legacy memory DTO removal, ladder
  simplification — needs consumer migration + ADR, review itself says
  "after stabilization") and item 7 (20-30 replica gameplay run — needs an
  authorized mutation budget; no gameplay turns ran in this session,
  canonical world untouched at T32/event 469).
- Open: session-row pruning observation;
  hanging-primary-consumes-budget trade-off noted for later.
  (Done 2026-09-12: installed updater re-copied from repo by root —
  `/usr/local/bin/update-orange-pi.sh` and the systemd unit both diff-clean
  against the tree, service active.)

# Current work (2026-09-12 — opencode_run live in prod, gate reconciled; superseded by the review-fixes entry above)

- P1 CLOSED: `opencode_run` passes live (`ok`, ~20-22s) on the final code.
  Cause chain, each proven: env scrub exonerated by a shell isolation run
  (`PONG`, ~7s); systemd EROFS killed the child (3.1s exit non-zero);
  opencode log revealed a fourth write dir (`~/.local/state/opencode`,
  locks/models.dev fetch) and a hidden auto-titling model roundtrip.
  Fixes: unit keeps `ProtectHome=read-only`, admits exactly the four
  opencode state dirs; argv passes fixed `--title skald-narrate` (log
  confirms `title=skald-narrate`, no title stream); probe budget 25s.
  `~/.npm` stays read-only deliberately: the background plugin install
  fails closed there, and admitting it could open a tool-loading path.
- P2 reconciled at the time: installer/updater parse `readiness.status` and accept
  `ready`|`degraded` (ADR-0036 amendment 2026-09-12; ARCHITECTURE, README,
  DECISIONS D-036, deploy-policy pins updated). Installed updater re-synced
  from repo by root; the new gate accepted `degraded` live with exit 0 on
  the `3893614` deploy. Probe curl budget 30s→60s (worst case is two
  sequential 25s route budgets).
- Deploys that session: `6615abd` (gate+unit-3-dirs), `eb8952a`
  (title+20s+4th dir), `3893614` (curl 60s, 25s budget). On-device suites
  PASS each time; service + timers active. Probe then: `degraded`
  (accepted), Ollama ok ~0.6s, `opencode_run` ok 21.5s.
- Observed (external, no action): Ollama Cloud stalled ~11:29–11:33 UTC
  (three consecutive full-budget probe timeouts; Pi egress+DNS verified
  fine, direct fetch 0.4s; recovered spontaneously). Note for the future:
  a hanging primary consumes the sequential route budget before the backup
  engages — parallel racing or per-candidate caps would change that
  trade-off, deliberately not done here.
- Open at the time: session-row pruning for opencode.db (orphan rows from the timed-out
  probes were deleted manually); human playthrough still untouched.

# Current work (2026-09-12 — OpenCodeRunProvider deployed, live smoke PASS, adapter fails closed under sandbox)

- Updater run as `nooker` (no sudo): backup
  `backup-3e9cdceedf54cddbc4f25080b8d4744767db1d2c-pre-update-20260912-130231.sqlite`
  created+verified, fast-forward `3e9cdce` → `617547e`, on-device suite
  172 files / 2124 passed / 1 skipped, restart, health gate PASS,
  `Update complete`. Remote `main` == `origin/main` == `617547e`;
  `skald.service`, healthcheck and backup timers active.
- Service env set before restart (backup
  `skald-data/skald.env.bak-pre-opencode-20260912`): `SKALD_OPENCODE_RUN=1`
  and `SKALD_OPENCODE_BIN=/home/nooker/.opencode/bin/opencode` appended to
  `/home/nooker/skald-data/skald.env` (`opencode` is on neither the service
  PATH nor the shell PATH; narrative agent file present). Service restart via
  updater picked them up; file stays 600/nooker.
- Live `POST /api/ops/ai-probe` after deploy: `ok:false`, status `degraded`
  (pre-existing shape: interpret Ollama ok + synthetic unavailable slot).
  Narrate slot proves the adapter is live in the route: `ollama_cloud`
  ok in 651ms, `opencode_run` failed in `request` phase after 3136ms —
  the binary spawns under the service but exits non-zero fast. Prime
  suspect: `ProtectHome=read-only` blocks opencode session-state writes
  under the sandbox; fail-closed holds, gameplay narration unaffected
  (Ollama keeps priority). Sandbox fix needs an installer-level unit change
  (read-write state dir + daemon-reload) — not done here.
- One narrate smoke on `world-097b4463` (T31→T32, event 451→469):
  `осмотреться` 200 + `ok:true` + live `presentation.primary` + state +
  exactly +1; same-key replay HTTP 409 `duplicate_request` with no new tick;
  `/api/health` 200; final scoped state matches (T32, event 469).
- Note: the installed `/usr/local/bin/update-orange-pi.sh` has no AI
  readiness gate (prints `Update complete` right after the health gate);
  the repo copy carries step 11 (loopback ai-probe must be 200). With the
  current provider shape (Ollama single model + opencode_run backup-only on
  narrate) readiness stays `degraded` by design, so the repo gate would fail
  where the installed updater passes. Reconcile the two scripts before the
  next deploy.
- Open: sandbox write access for opencode state, successful adapter-call
  latency in prod (blocked on the above), session-row pruning observation.

# Current work (2026-09-11 — OpenCodeRunProvider adapter implemented)

- New `packages/cli/src/runtime/opencode-run-provider.ts`:
  `OpenCodeRunProvider extends ModelRouter` serves `opencode_run` candidates
  via one `opencode run --format json` subprocess per call; all other
  providers flow through the base implementation untouched (same seam as
  `FixedNarrationProvider`). `ProviderId`/`ProviderProtocol` unions gain
  `opencode_run`; `http.ts chatOnce` rejects it fail-closed so a miswired
  candidate can never leak into an HTTP endpoint.
- Containment enforced in code, all tested: argv-only prompt transport (no
  shell), scrubbed env allowlist (no `*_API_KEY` crosses), fresh empty temp
  dir per call (removed afterwards), NDJSON parse fails closed on malformed
  lines / run errors / any tool-shaped activity, 96KB message cap,
  256KB stdout cap with kill, SIGTERM→SIGKILL on timeout (timeout retryable,
  everything else fails fast), best-effort `session delete` with tight id
  validation, prompt contract stays versioned in Skald code (agent file
  carries containment role only).
- Factory wiring in `router-factory.ts`, default-off behind
  `SKALD_OPENCODE_RUN=1`: appends the `opencode_run` candidate last on the
  narrate route only (Ollama keeps priority; interpret untouched),
  constructs `OpenCodeRunProvider` when enabled, survives selection
  refresh. Env overrides: `SKALD_OPENCODE_BIN` (required on Pi service —
  `~/.opencode/bin` is not on its PATH), `_AGENT`, `_MODEL`.
- Tests: 27 new in `opencode-run-provider.test.ts` (argv/env/NDJSON/timeout/
  kill/caps/cleanup/delegation/diagnostics, incl. real-subprocess checks),
  + factory append/refresh cases in `router-factory.test.ts`, + HTTP-layer
  guard in `http.test.ts`. Full `npm run validate` PASS.
- Not yet: Pi deployment of the agent file + service env, live
  smoke of one narrate turn through the adapter, latency measurement in
  prod, pruning observation.

# Current work (2026-09-11 — narrative agent containment verified on Pi)

- `~/.config/opencode/agents/narrative.md` created on Pi (mode primary,
  pinned `opencode/muse-spark-1.3-contributor-free`, temperature 0.1, all
  16 permission keys explicit deny). `agent list` resolves denies after
  global allows (agent overrides global).
- Behavioral bait test through the real path (`run --format json --agent
  narrative`, prompt demands glob-then-DONE): event stream contains only
  `step_start/text/step_finish`, zero tool calls. Containment holds.
- Open production points: agent lives in global Pi config (not versioned,
  not deployed via updater — decide repo-owned vs global); session-row
  pruning for opencode.db; latency vs turn budget still unmeasured in prod.

# Current work (2026-09-11 — integration decision: run-subprocess, design sketched)

- Decided: Skald ↔ OpenCode via `opencode run` subprocess per narrative
  call, NOT serve-daemon. Rationale: no daemon lifecycle/ports/secrets on
  the Pi, crash isolation per call, stateless calls mirror the
  never-authoritative narrative invariant (no cross-turn contamination),
  trivial timeout+kill and fake-binary testing.
- Measured cost: `--format json` gives NDJSON events
  (step_start/text/step_finish with tokens/cost); one narrative call =
  ~14.5s wall on Pi (mostly startup+session init; model span ~20ms),
  exact `{"probe":true}` output, zero tool calls on a trivial prompt,
  cost 0. Latency vs turn budget is the open integration checkpoint.
- Prerequisites before production: custom tools-less `narrative` agent
  (`agent create` supported) + empty cwd + env scrub (containment);
  session-row pruning policy for opencode.db growth; keep deterministic
  fallback on timeout/kill. Serve remains the fallback if latency bites.
- PC split-tunnel still an operator-side UI action; unrelated to Pi plan.

# Current work (2026-09-11 — Zen free works on Pi via app flow, no auth needed)

- POC done, no daemon needed: `opencode run -m
  opencode/muse-spark-1.3-contributor-free` on the Pi answers correctly —
  PING verbatim, then exact `{"probe":true}` (JSON discipline holds at
  micro level). No `serve`, no session API guessing, no LAN ports.
- Surprise: `opencode auth list` shows 0 credentials and no `auth.json`
  exists on the Pi — Zen free answers anyway from DE egress. The operator
  login step turned out unnecessary; nothing secret was created or moved.
- Standing open: integration shape (serve+session API vs `run`
  subprocess), agentic-loop containment for narrative calls, systemd
  wiring, PC split-tunnel fix remains operator-side UI action.

# Current work (2026-09-11 — Amnezia cause found: PC split-tunnel bypass, Pi fine)

- Symptom: Amnezia "up" on PC, yet muse-spark geo-block and RU egress.
  Cause, proven: native Windows apps bypass the tunnel — `curl.exe`,
  .NET sockets and `node`/`opencode` all egress RU (`loc=RU`), while the
  SAME destination from WSL egresses DE. Tunnel itself is healthy
  (tracert transits it; WSL proves exit works). So the Amnezia Windows
  client split-tunnels native-app traffic direct — per-app exclusion,
  not a dead tunnel, metric or proxy issue (no proxy configured,
  AmneziaVPN metric 5 wins routing, Find-NetRoute confirms).
- Pi is unrelated and fine: its `awg-nl` path egresses DE (`loc=DE`);
  the Pi-side Zen failure is pure `MissingSessionID` session lockout,
  which no VPN routing can change. No Pi network fix needed or applied.
- Fix (operator UI action, not applied by agent): Amnezia UI → split
  tunneling → remove exclusions / include dev tools, so `node`/`opencode`
  ride the tunnel. Verify with one line in PowerShell:
  `curl.exe -s https://1.1.1.1/cdn-cgi/trace | Select-String 'loc='`
  (want non-RU), then re-run the muse-spark `opencode run` probe.
- Nothing on the Pi was changed; no Skald code changes from this.

# Current work (2026-09-11 — OpenCode-gateway POC: serve works, muse-spark geo-blocked)

- POC ran on PC (no Go toolchain needed; `opencode run` covers it):
  `opencode serve` on 127.0.0.1:4096 healthy; `opencode run -m
  opencode/muse-spark-1.3-contributor-free` fails with "This model is not
  available in your country" — a third, geo-shaped refusal on top of the
  direct-API 400 `MissingSessionID`. Control `opencode/big-pickle` returns
  PING through the identical app flow, so the flow is fine and the block is
  model-specific. No paid calls made.
- Consequence for the gateway idea: `serve → Zen` is not a universal fix;
  an `OpenCodeNarrativeProvider` adapter is technically viable but needs a
  model that answers (big-pickle does, muse-spark does not — here), plus
  design for agentic-loop containment, PC-always-on coupling, and LAN auth.
  Test server removed; harness :3600 untouched.
- Note: per-call `opencode` processes do not survive between tool calls in
  this environment — future automation must own the serve lifecycle in one
  shot or via a supervisor.
- Paid-check question (2026-09-11): full `opencode models` shows paid
  candidates exist — `opencode-go/muse-spark-1.3-contributor`,
  `opencode-go/muse-spark-1.2-contributor`, `openrouter/meta/muse-spark-1.3`
  (+1.2/1.1). Verdict: do NOT probe yet — only needed if the adapter gets
  built around paid muse-spark specifically; one call settles it then.

# Current work (2026-09-11 — opencode-serve hypothesis refuted, Zen block confirmed provider-side)

- External hypothesis checked and rejected: no `opencode` CLI exists on the
  Pi, nothing listens that Skald could use as a serve backend, and Skald
  never shells out to OpenCode — it calls provider HTTPS directly with the
  key from `skald.env` (all three key names present; service reads exactly
  that file via `EnvironmentFile`). No `auth.json` is involved anywhere.
- Decisive isolation: byte-equivalent Zen `/responses` call from a Pi shell
  (zero Skald code) returns the same HTTP 400 `MissingSessionID`. Same key
  gets catalogue 200. So neither request building nor systemd-vs-shell
  environment is at fault — the provider refuses free-tier server-side use
  as policy. Nothing to fix on our side for Zen free.
- Standing paths unchanged: Ollama active, OpenRouter rung idle-by-design,
  fail-closed clarifications otherwise. Paid `muse-spark-1.3` stays an
  operator-billing decision, not an engineering task.

# Current work (2026-09-10 — OpenRouter rung deployed, ai-probe PASS)

- Updater run as `nooker` (no sudo): backup
  `backup-3cb08baa7b2e3c8be4a7816481ac9416427c9662-pre-update-20260910-232419.sqlite`
  created+verified, fast-forward `3cb08ba` → `3e9cdce`, on-device suite
  171 files / 2094 passed / 1 skipped, restart, health gate PASS.
  `skald.service`, healthcheck and backup timers active; `/api/health` ok;
  scoped `/api/worlds/world-097b4463/state` 200 (T31, event 451). Unscoped
  `/api/state` 404 `legacy-world` unchanged (pre-existing, no primary
  entrypoint).
- Live `POST /api/ops/ai-probe`: HTTP 503 by design, status `degraded` —
  Ollama `gemma4:31b-cloud` passes interpret+narrate live; Zen frees stay
  `model_unavailable`. OpenRouter rung correctly idle (no free quota spent
  while Ollama answers); deployed tree verified to contain the wiring.
- Post-deploy Go re-probe of the pinned primary (2 calls, quota now 10/50):
  `nemotron-3-super` interpret+ narrate ok in 682/369ms. Temp files removed.
- Rollback was not needed. Local `main` == `origin/main` == `3e9cdce`.

# Current work (2026-09-10 — OpenRouter wired as last-resort rung, uncommitted)

- Operator inserted `SKALD_OPENROUTER_API_KEY`; throwaway Go probe (8 calls,
  server-side, key never left the Pi): nemotron-3-super-120b-a12b:free
  interpret+ narrate ok in 726/342ms; laguna-s-2.1:free interpret ok in
  697ms; lightning:free answers 200 but ignores both markers; gemma-4-31b-it
  429-capped at probe time. Temp files removed.
- Wired `openrouter` provider end to end (uncommitted, gate PASS, 2094
  passed): ProviderId, config entry + pinned free list, discovery rung
  Zen → Ollama → OpenRouter with sequential probing (quota-safe: winner
  stops further calls; rung untouched while earlier ones answer), 402 →
  `insufficient_credits` + `quota_exceeded` exclusion, key plumbing through
  factory/refresh/manager, intent-gateway allowlist, env examples, deploy
  README. Tests for every new export.
- Open decisions for operator: free-endpoint training exposure on
  `player_input` (accepted for testing; revisit ZDR/paid if it matters),
  and 50/day quota (OpenRouter stays last resort, so daily refresh spends
  zero while Ollama answers).
- Still uncommitted (same tree): assistant-prefill repair refinement.

# Current work (2026-09-10 — paid Zen probe verdict: 401, accept fail-closed)

- With operator consent, probed 3 paid Zen routes synthetically (no player
  data, temp test deleted after, device repo verified clean): catalogue GET
  200 with all three PRESENT, but POST /chat/completions 401 on
  deepseek-v4-flash, glm-5.3-flash and minimax-m3 alike. The credential has
  no paid entitlement (catalogue-valid key, billing not enabled) — an
  account-level block, not a per-model or code issue. Spend: $0.
- Decision: accept fail-closed clarifications for complex input. Coverage
  stays: deterministic fast path for simple commands, natural clarification
  without mutation for the rest, Ollama narration. Revisit only if the
  operator enables Zen billing (then re-probe) or free server-side use
  reopens. No model roulette, no blind tag guessing.
- Still uncommitted: assistant-prefill repair refinement (gate PASS) —
  worth committing regardless as validated hardening.

# Current work (2026-09-10 — repair loop deployed, rescue unproven; prefill ready)

- Deployed `3cb08ba` via updater (backup verified, on-device 170/2073
  PASS, health gate PASS). No ten-turn smoke this round (no gameplay
  changes); two live V2 probes instead.
- Live V2 probes after deploy (2 inputs, 4 model replies): repair loop
  fires mechanically (`proposal_repair_requested` → second interpret call
  → still `proposal_schema_rejected` → safe generic clarification, no
  ticks, no events). One correction round does not rescue gemma4 contract
  adherence on these inputs.
- Refinement (uncommitted, in working tree, gate PASS): the repair turn now
  anchors on the model's own prior reply (assistant prefill, truncated,
  never persisted/logged) instead of a bare note. Hypothesis: the note
  alone cannot show what to correct. Tests pin the 4-message shape.
- Open decision: commit+push+deploy the prefill and re-probe once; if the
  rescue still fails, stop tuning and decide on the model (paid Zen probe
  needs operator consent; no blind tag roulette).

# Current work (2026-09-10 — V2 schema compliance fix, uncommitted)

- Live evidence (synthetic probe, no player data): Ollama Cloud accepts
  `format:"json"` (HTTP 200) but it only guarantees well-formed JSON, and
  Cloud docs state structured outputs are unsupported. The model returns
  parseable JSON in an invented envelope (`proposal`/`interpretation`)
  instead of the flat TurnProposalV2 — so fence-tolerant parsing would not
  help; the gap is contract adherence.
- Fix (uncommitted, in working tree): exact top-level key list plus a
  compact action example in the system prompt; one repair round in the
  gateway carrying only the sanitized rejection reason (accepted and
  clarification replies never repair; still-invalid follows the normal
  invalid path; shared overall timeout budget); `temperature: 0` for
  Ollama interpret calls (narrate untouched). New `proposal_repair_requested`
  diagnostic; validation still owns acceptance.
- Repository gate: PASS (`npm run validate`; 2077 passed, 1 skipped).
  Still open: commit+push, deploy, live V2 re-probe with the repair loop.

# Current work (2026-09-09 — plan_7 deployed to Orange Pi, smoke PASS)

- Updater run as `nooker` (no sudo): backup
  `backup-fc7cbbb2a5c3dee3a92144b2f23980ccaa3a3653-pre-update-20260909-235224.sqlite`
  created+verified, fast-forward `fc7cbbb` → `0850cef` (6 plan_7 commits),
  on-device suite 170 files / 2073 passed / 1 skipped, restart, health
  gate PASS. `skald.service`, healthcheck and backup timers active.
- Production DB migrated live v11→v12: `user_version=12`,
  `conversation_context_json` present, all 26 transcript rows preserved
  (NULL metadata, legacy heuristic applies).
- Ten-turn smoke on `world-097b4463` (T21→T31): all 200 + `ok:true` +
  live `presentation.primary` + state + exactly +1; duplicate key 409;
  `/api/health` 200; final scoped state matches. First live execution of
  the plan_7 code.
- Live V2 probes (2, Russian pronoun input): transport+schema-probes PASS
  (ollama_cloud/gemma4 ~950ms), but both proposals failed static schema
  validation → safe generic clarification, no ticks, no events. Fail-closed
  chain works as designed; model schema compliance is the open item
  (hypothesis: fenced/non-JSON prose; raw bodies are unlogged by design).
  Clarification metadata persists live (verified on-disc).
- Anomaly (pre-existing): unscoped `/api/state` 404 `legacy-world`, none
  created. Rollback was not needed. Local `main` == `origin/main`.

# Current work (2026-09-09 — plan_7 implemented; superseded by deploy entry above)

- plan_7 §§1,3,4,6,7,8,9,10,11 were implemented, committed as 6 commits per
  §12 (`9fb97e6` → `0850cef`), pushed, and deployed (see entry above). No
  new Domain Events; Rules never read the transcript; LLM stays
  non-authoritative. Remaining open items: model schema compliance for the
  live envelope, browser QA with an authorized click budget, human 15–20
  replica playthrough.

# Current work (2026-09-09 — LLM fallback deployed to Orange Pi, smoke PASS)

- Updater run as `nooker` (no sudo): backup
  `backup-de906c7eefb799552e5292e8918eca754b76a044-pre-update-20260909-214901.sqlite`
  created+verified, fast-forward `de906c7` → `fc7cbbb`, on-device suite
  168 files / 2037 passed / 1 skipped, restart, health gate PASS.
  `skald.service`, healthcheck and backup timers active; `/api/health` ok.
- Live `POST /api/ops/ai-probe` after deploy: first non-`unavailable`
  result — `degraded` (endpoint HTTP 503 by design, 200 is ready-only).
  Ollama `gemma4:31b-cloud` passes interpret+narrate live; both Zen frees
  excluded as `model_unavailable` (MissingSessionID lockout persists).
  The provisional cloud tag is thereby verified live; the TODO in
  `config.ts` can be closed on the next touch.
- Ten-turn smoke on `world-097b4463` (T11→T21): all 10 ticking turns
  200 + `ok:true` + live `presentation.primary` + state + exactly +1;
  duplicate keys replay 409; `/api/health` 200; final scoped state matches
  (T21, event 332). Movement turn reached a new location (T19 путевой
  двор); live narration rows carry `usedFallback:false`.
- One honest clarification inside the smoke (`поздороваться` with nobody
  around → persisted `clarification` turnSeq 22, no tick, no events).
  Correct V2 behavior through the live Ollama path, not a regression.
- Anomaly (pre-existing, not a regression): unscoped `/api/state` answers
  404 `world_not_found: legacy-world` — still no primary entrypoint, none
  created. Rollback was not needed.

# Current work (2026-09-09 — LLM selection fallback fixed, uncommitted)

- Root cause confirmed: Zen locked `-free` models to OpenCode app sessions —
  every server-side call fails 400 `MissingSessionID`
  (`free_tier_session_required`), catalogue stays 200. Request building was
  never the fault. With no fallback, discovery activated nothing and
  readiness stayed `unavailable`.
- Fix (uncommitted, in working tree): provider-ordered discovery (Zen first,
  pinned Ollama Cloud `gemma4:31b-cloud` fallback when Zen activates
  nothing); `MissingSessionID` mapped to `free_tier_session_required`;
  single working model reports `degraded` (provider-probe + discovery);
  `AIReadinessService` now reads the router live selection/fingerprint so
  daily refresh cannot leave stale startup models in readiness; live route
  results own the status (stale `degraded` no longer masks total failure).
- Repository gate: PASS (`npm run validate`; 168 files, 2037 passed,
  1 skipped; typecheck, Canon, simulation/eval, adventure, diff-check).
  New regressions: live-selection preference, stale-degraded masking,
  Ollama dual-probe activation, Zen-first ordering, single-model degraded.
- Still open (no commit/push/deploy in this session): live TurnProposalV2
  provider probe on-device (needs deploy of this tree + healthy routes),
  NTFS browser QA with authorized click budget, human 15–20 replica
  playthrough. Device still runs `de906c7` without this fallback.

# Current work (2026-09-08 — P0 deployed to Orange Pi, smoke PASS)

- Updater run as `nooker` (no sudo): backup
  `backup-6a720ed4c4c44017962bbefe810667332df205d5-pre-update-20260908-222552.sqlite`
  created+verified, fast-forward `6a720ed` → `de906c7`, on-device suite
  168 files / 2024 passed / 1 skipped, restart, health gate PASS.
  `skald.service`, healthcheck and backup timers active; `/api/health` ok.
- Ten-turn smoke on the `/api/continue` world (`world-097b4463`, T1→T11):
  all 200 + `ok:true` + non-null `presentation.primary` + state + exact +1
  per turn through the new gateway path; final state matches; duplicate key
  returns 409. First live execution of the P0 wiring.
- Anomalies (pre-existing data conditions, not regressions): no primary
  world entrypoint, so unscoped `/api/state` and `/api/command` answer 404
  `world_not_found: legacy-world`; smoke ran on the scoped route instead.
  No entrypoint was created or changed in this session.
- `POST /api/ops/ai-probe` still `unavailable` after deploy (Zen routes
  fail; 400 pre-deploy, configuration-phase failure post-deploy). Live
  TurnProposalV2 model verification stays blocked on provider transport.
- Rollback was not needed. Local `main` == `origin/main` == `de906c7`.

# Current work (2026-09-08 — live provider check for TurnProposalV2: BLOCKED)

- Device `orangepi4-lts` reachable, `skald.service` active, deployed commit
  `6a720ed` is 16 commits behind local `main` (`5b39610`): no TurnProposalV2
  code (gateway, prompt, validator, production wiring) exists on the device.
- Live `POST /api/ops/ai-probe` (19:18 UTC, non-mutating): readiness
  `unavailable`. Both Zen routes (`muse-spark-1.3-contributor-free` primary,
  `ling-3.0-flash-fin-free` backup) fail interpret+narrate with HTTP 400 at
  `response_status`. Providers are down at transport level right now.
- V2-specific live checks (model schema compliance on TurnProposalV2,
  Russian V2 input end-to-end, hidden-ID scan of the live prompt, live
  timeout) cannot run anywhere: no provider keys in the local environment,
  and deploying needs commit+push authorization plus the updater run.
- Unblock sequence: authorize commit+push of P0, run the skill update
  workflow, re-run ai-probe until `ready`, then probe V2 over
  `/api/worlds/:id/command` on a test world (never the canonical save).
  No mutation was performed in this session; working tree still carries the
  uncommitted P0.

# Current work (2026-09-08 — P0 Master Turn Gateway production wiring)

- Status correction for the previous milestone: the V2 contracts, builders,
  validators, executor and persistence were implemented and component-tested,
  but production `/api/worlds/:worldId/command` still used the old
  `interpretPlayerInput` path without ConversationContext, scene, focus or
  TurnProposalV2. That was foundation, not a gateway.
- P0 now connects the gateway in `handleWorldCommand`: short queue snapshot
  (events/world/recent turns/scene/conversation), `interpretMasterTurn`
  outside the queue (deterministic fast path or closed TurnProposalV2 with
  static + contextual validation), then queue execution with revalidation and
  atomic Events + ConversationTurn commit. The legacy V1 LLM proposal path is
  no longer called from production; `intent-gateway.ts` remains only for
  test/REPL compatibility.
- New: `runtime/master-turn-gateway.ts`, `listRecentConversationTurns`
  (newest-first fix for the ASC LIMIT behavior), atomic commit hook in
  `master-turn-executor.ts`, `buildSpeechConversationTurn`, validated-plan
  execution (action/mixed/speech/inquiry/meta) in `world-handlers.ts`.
- Milestone state: Implemented: contracts/builders/validators/executor/
  persistence/gateway/production wiring. Integrated: yes (single production
  path: fast path vs V2, no V1 LLM fallback). Validated: repository gate
  (see below). Externally verified: no (live provider probe and browser QA
  still required). Player-ready: no (awaits live probe + human playthrough).
- Repository gate: PASS (`npm run validate`, Node v22.23.1; 168 test files,
  2024 passed, 1 skipped; typecheck, Canon, simulation/eval, adventure
  acceptance and diff checks). Focused suites added by this stage: master-turn
  gateway (9), master-turn HTTP production path (7), speech turns (2) and
  recent-transcript ordering (1).
- Next: live TurnProposalV2 provider probe (schema compliance, Russian
  input, timeout/fallback, no hidden IDs in prompt), NTFS browser QA through
  `$skald-ntfs-browser-qa` with an authorized click budget (15-20 replica
  human scenario), then Orange Pi deploy via `$skald-orange-pi-deploy`.
  `plan_1.md`–`plan_7.md` remain untracked working notes, not commits.

# Current work (2026-09-03 — plan_5 AI liveness/readiness/deployment contract)

- Simulation liveness remains separate from AI readiness: `/api/health` does
  not call providers; loopback `POST /api/ops/ai-probe` runs a cached,
  serialized no-world probe and returns HTTP 200 only for `ready`.
- LLM routes now use an ordered OpenCode Zen preference list. Production
  startup fetches the live model catalogue and probes every preferred model for
  both interpret and narrate; only probe-valid catalogue entries are routed.
  The readiness report names active/backup models and sanitized exclusion
  reasons. Transport failures are typed and sanitized; retry and failover
  policies are distinct and bounded by one overall request budget.
- One provider factory captures provider-scoped keys for gameplay, Intent,
  Narration and readiness. Intent and provider diagnostics are structured and
  remain outside player-facing DTOs and transcripts.
- Deployment scripts require the readiness probe before printing success;
  `SKALD_AI_REQUIRED=1` additionally requires a Zen credential and two live
  probe-valid models. Ollama remains an optional compatibility provider and is
  not used as a static Zen fallback.
- The local deployment preflight now checks HTTP liveness independently from
  the canonical SSH identity in five sessions. HTTP 200 with a wrong user,
  host, repository, data path or inactive service is the blocked state
  `HTTP_ALIVE_SSH_IDENTITY_MISMATCH`; no alternate target is substituted.
- Repository gate: PASS (`npm run validate`, Node v22.23.1; typecheck,
  full Vitest suite, Canon validation and diff checks). Live provider probe on
  Orange Pi `orangepi4-lts` (remote commit `8cb2380f393f9b86c0c753f5e4789889b0930033`)
  ran directly because the deployed service still returns 404 for
  `/api/ops/ai-probe`: the previous deployed build's static OpenCode Zen model
  failed HTTP 401 on both `interpret` and `narrate`, while Ollama Cloud
  `gemma4:31b-cloud`
  passed HTTP 200 on both. Readiness is therefore degraded (2/4), and Orange
  Pi production acceptance remains failed/unverified: both provider key
  entries are non-empty, but the Zen credential is rejected and the remote env
  does not set `SKALD_AI_REQUIRED=1`; the plan_5 probe endpoint is also not yet
  deployed. After the credential file was updated and `skald.service` was
  restarted, the same four direct checks remained unchanged: Zen HTTP 401 on
  both routes, Ollama HTTP 200 on both; service and simulation health stayed
  active/ok.

# Current work (2026-09-01 — review hardening: public shell boundary and route UX)

- Game Shell and shell-delta HTTP responses now pass through a dedicated
  observer-safe serializer: world/location/situation/turn/event identifiers and
  map coordinates are not returned to the normal browser DTO. Observer thread
  references remain opaque read-side handles.
- The compatibility narrative endpoint and persisted transcript responses now
  fail closed to localized prose when a provider or event description contains
  internal/English text. Unknown situation types use a neutral localized copy.
- Legacy clickable `skald:travel` controls were removed from the stage. Known
  routes remain read-only context; travel is expressed through the command
  composer. The composer explicitly declares `resize: none`.
- Progress-aware copy reports the active journey destination and remaining
  stages instead of repeating an unqualified travel rejection.
- External browser QA after the production save reset: menu/empty-save baseline
  PASS; shell/map/network checks BLOCKED because there is no world and mutation
  budget is zero. This is separate from repository validation.
- Repository gate after these changes: PASS (145 test files, 1794 passed,
  1 skipped; typecheck, Canon, Simulation, Eval, acceptance and diff-check).

# Current work (2026-09-01 — review hardening: read-side identity and observer-safe player copy)

- Fixed equal-world-time narration identity end-to-end. Read-side SQLite schema
  v10 stores `(world_id, world_time, correlation_id)` while preserving v9 rows
  as explicitly uncorrelated legacy data; Events remain unchanged.
- Journal grouping retains the documented atomic `cmd-N`/`tick-N` cycle but
  keeps independent same-time turns separate. HTTP pagination exposes opaque
  `turnHandle` cursors; browser polling and Chat Feed pair by opaque
  `narrationHandle`, with unique-time fallback only for legacy DTOs.
- Transcript wait replies use the actual committed tick correlation. Late
  journal loads and stopped polling sessions are ignored after a world switch.
  Narration-unavailable operational status is no longer rendered in the chat.
- Added persistence, migration, journal, HTTP, polling, Chat Feed and
  pagination regressions. Repository gate: PASS (145 test files, 1791 passed,
  1 skipped). Browser QA for the dirty WSL snapshot remains separate from
  repository validation and requires a browser task that can load this snapshot.

# Current work (2026-08-24 — Player Knowledge Presentation)

- The normal Knowledge surface now consumes the frozen, observer-safe
  `PlayerKnowledgePresentation` DTO. It groups entries as seen, told,
  inferred and doubt, includes plain-language origins, hides foreign or
  unknown provenance, and caps the startup view at three entries.
- Game Shell, command/wait/inquiry responses, Presence and legacy state routes
  use the same read-side builder. Internal `BeliefModelDTO` remains available
  only through the trusted beliefs/diagnostics surface and is not rendered by
  the normal UI. No Domain Events, Rules, Projection fields or persistence
  tables were added.
- Focused and full repository tests pass locally; browser QA was not run in
  this task and no commit, push or deployment was performed.

# Current work (2026-08-23 — ConversationTurn review fixes)

- Player input is no longer copied into newly emitted Domain Event payloads:
  `rawText`, nested parser `raw` references and `utterance` are removed at the
  command boundary; relation handling consumes semantic speech metadata while
  retaining a read-only legacy fallback for old events.
- Journal turns expose the selected response correlation when unambiguous;
  Chat Feed pairs action turns by `correlationId` first and only falls back to
  world time. Legacy command transcript timing now reads the projection
  snapshot directly instead of deriving `timestamp - 1`.
- Regression coverage includes serialized Domain Event payloads, equal-time
  action pairing, and journal correlation propagation.
- `npm run validate` PASS: 135 test files, 1654 passed, 1 skipped; typecheck,
  Canon, simulation/eval, adventure acceptance and diff checks PASS.
- Fixed NTFS browser QA remains BLOCKED in this session: thread
  `019fa52b-1610-7b23-9567-37891d24c782` was unavailable
  (`RECEIVER_NOT_FOUND`). No deployment or production SQLite mutation was run.

# Current work (2026-08-25 — observer-safe discovery projection)

- `/discoveries` now serializes a frozen `PlayerDiscoveryJournal` instead of
  exposing the internal DiscoveryJournal/BeliefModel shape. Cards and rumors
  contain only localized player prose, stage/status and simulation time; raw
  discovery ids, subject/journal/source refs, observer ids, confidence and
  freshness are removed. Foreign or provenance-less `RumorHeard` events are
  excluded.
- The discovery renderer uses a local card index and world time for navigation,
  so it no longer reads internal card or journal identifiers. The legacy
  `heat_changes_material` copy is localized and covered by safe DTO tests.
- Focused discovery/Game Shell HTTP tests and typecheck pass. The repository
  gate passes with 143 test files, 1769 passed and 1 skipped; Canon,
  simulation, eval, adventure acceptance and diff checks pass. Fixed NTFS
  browser QA remains externally blocked. No commit, push or deployment was
  performed.

# Current work (2026-08-22 — durable ConversationTurn transcript)

- ConversationTurn is now a read-side persistence contract. SQLite schema v9
  stores player text, deterministic response metadata and infrastructure
  createdAt; old databases migrate without backfill.
- Action commits use the RuleEngine read-side prepare hook so Events,
  processed_requests, conversation_turns and last_played_at commit atomically.
  Inquiry and clarification paths persist without Events or world-time changes.
- Journal DTOs expose player-facing conversationTurns without requestHash;
  command responses return the persisted turn and the chat feed hydrates
  `ТЫ → МАСТЕР` pairs after reload while keeping LLM narration separate.
- `npm run validate` PASS. The initial three local commits cover persistence,
  integration and UI hydration; the review fixes are tracked above.
- Fixed NTFS browser QA is BLOCKED in this session: thread
  `019fa52b-1610-7b23-9567-37891d24c782` was unavailable
  (`RECEIVER_NOT_FOUND`). No deployment or production SQLite mutation was run.

# Current work (2026-08-21 — player atlas and context space)

- Blocks 6–7 are implemented in code commit `8f85b57`. ObserverMapDTO schema v4
  exposes only observer-safe presentation geometry: adjacent known terrain is
  merged into seamless polygons, fog/reveal geometry is deterministic and
  stable across world-time changes, exact rumours remain hidden, glimpses are
  approximate, and routes appear only after their own spatial observation.
- The former nested Context administration rail is now one full-screen player
  space with exactly three tabs: Карта, Ты, Знания. The map dominates its
  surface; character data is written as background, loss, obligation,
  relations, accessible items and conditions; knowledge is grouped by source
  (seen, told, inferred, doubted) from BeliefModelDTO.
- Keyboard tab navigation supports ArrowLeft/ArrowRight/Home/End with roving
  tabindex. Escape closes the space and restores focus. Canonical contact ids
  are sanitized in all rendered belief text while structural DTO identity stays
  intact.
- This slice adds no Domain Events, Rules or persistence state. It consumes the
  existing Event Log projections through GameShellSnapshot, BeliefModelDTO and
  ObserverMapDTO.
- Full `bash scripts/validate.sh` PASS: 131 test files, 1596 passed,
  1 skipped; Canon, Simulation, 10 eval scenarios, 46-step Adventure acceptance
  and diff checks PASS.
- Real NTFS browser QA against a temporary local SQLite world PASS on desktop
  and 390x844 mobile: map/fog/current position, Карта/Ты/Знания, natural contact
  labels, keyboard/focus behavior, no horizontal overflow and zero console
  errors/warnings. Mutation ledger: one temporary world creation, two Presence
  acknowledgements (the second restored the lease after server restart), zero
  gameplay/inquiry/retry actions; world time remained T0.
- Code commit `8f85b576fb3034e2adafa911434bbf90a705d4f0` is pushed to
  `origin/main` and deployed to Orange Pi. The updater verified backup
  `/home/nooker/skald-data/backups/backup-10c51be28da191a702fb35386b5b999897e3f1a3-pre-update-20260821-212745.sqlite`,
  fast-forwarded cleanly, ran all 1596 tests on-device and recovered health.
- Post-deploy service evidence: `skald.service`, healthcheck timer and backup
  timer active; `/api/health` reports SQLite/multiWorld healthy. The required
  ten-turn production API smoke returned ten HTTP 200 responses with state and
  primary presentation, advanced T91->T101 exactly, matched final event 656,
  and the duplicate idempotency key returned HTTP 409.
- Production NTFS browser QA at `#/world/riverwatch-main` PASS for desktop and
  390x844 mobile: Map/You/Knowledge, fog/current position, source-grouped
  knowledge, no raw contact ids, keyboard/focus behavior, reload persistence,
  no overflow and zero console warnings/errors. One Presence acknowledgement
  restored the lease; no gameplay/inquiry/retry actions; T101->T101. Screenshot
  capture is BLOCKED by the browser runtime timeout
  `Page.captureScreenshot`; this is an evidence-tool limitation, not an
  observed application defect.
- Dependency installation reports 6 audit findings (3 moderate, 2 high,
  1 critical); no automatic breaking `npm audit fix --force` was applied.
  The independent timed 30–60 minute human experiential gate remains OPEN.

# Current work (2026-08-16 — ADR-0034 FirstEntryDTO and entry modes)

- First launch and return Presence are now checkpoint-driven: authored
  living-region starts expose deterministic observer-safe FirstEntryDTO;
  existing or incompatible checkpoints use the return surface.
- The same DTO composer feeds /api/new-game/prologue and observer-session;
  onboarding renders the scene before the one-click create -> observer-session ->
  acknowledge -> Game Shell chain. Acknowledge remains idempotent and
  resume-safe.
- ObserverSessionDTO is version 2; legacy worlds without background/entrypoint
  metadata keep the compatibility surface and receive firstEntry: null.
- Full validation after this milestone: 126 test files, 1566 passed, 1 skipped;
  Canon, Simulation, eval, adventure acceptance and diff checks PASS.
- Browser QA, commit, push and deployment remain separate and were not run in
  this task.

# Current work (2026-08-13 — ADR-0031 release evidence)

- Runtime commit is `4c2600e70dcb931024cbf3077f985ff90949e6ba`;
  `HEAD` equals `origin/main`. The working tree carries the uncommitted
  P1/P2 fixes and P3 doc sync below.
- Deterministic Adventure acceptance is PASS: 100% required beats, 4
  meaningful choices, 4 journey legs, 4 world changes, 4 discovery advances,
  3 map-growth steps, 90 offline meaningful events, zero truth leaks/orphans/
  duplicates, replay/idempotency/restart persistence PASS.
- Full validation is PASS: 125 test files, 1544 passed, 1 skipped; Canon,
  Simulation, 10 eval scenarios and diff checks PASS.
- Orange Pi production is on the same commit after an explicit service
  restart; `skald.service`, healthcheck timer and backup timer are active;
  `/api/health` reports SQLite/multiWorld healthy. Ten post-restart API smoke
  commands returned 200 and the duplicate key returned 409.
- Fixed NTFS browser task completed a fresh living-region acceptance on
  `world-msr2hlyd-1-rcbao7c4j09`: selected template and entry were verified
  in DOM, Presence=1, 27 commands including `advance 24`, T0→T53, rumour,
  four travel legs, masonry discovery, map fog/reveal growth, autonomous
  consequences, Knowledge/Chronicle, reload and mobile no-overflow PASS.
- The compound negative intent now returns clarification and never creates
  the forbidden destination `я не прямо к башне`; this is covered by gateway
  regression tests and production browser evidence.
- Evidence bundle: `docs/acceptance/full-adventure-evidence-2026-08-13.md`.
  Human experiential release gate remains OPEN: the bounded browser run is not
  an independently timed 30–60 minute human playthrough; screenshot, pending
  interval and separate network-status checks are also explicitly recorded as
  unavailable. Do not claim the ten-question interest rubric is complete until
  a tester records it.
- Added a machine-checkable intake for the missing human record:
  `npm run acceptance:adventure:review -- <review.json>`, with an intentionally
  failing template at `docs/acceptance/full-adventure-review.template.json`.
  It requires real 30–60 minute timestamps, one Presence acknowledgement,
  24–48 offline ticks, desktop/mobile screenshots, pacing ≤3 and all ten rubric
  answers true, and it now verifies artifact content, not just existence: the
  report JSON must conform to the AdventureReport schema, DOM notes must be
  non-empty, screenshots must be real image files (magic bytes) and the model/
  provider/task id must be real configured values. It does not manufacture or
  infer human answers.
- Adventure scenario shape is now validated before execution (20–35 commands,
  three choices, route/discovery loop, one 24–48 tick absence and restart).
  The report scans every player-facing snapshot for truth leaks and counts
  clarification replies in chat alternation.
- Human review evidence now requires provenance metadata and an explicit blocked-checks list.

# Codex Handoff

## Current work (2026-08-14)
- P2 fix: `place`/`use` intents are now fully canonical. They parse to
  `InteractionCommand` (verb `place`/`use`, `secondaryTarget` for the
  container, `instrument`/`goal` for the affordance) and run through the whole
  Interaction Model v1 chain — `InteractionRequested` → `InteractionTimeValidated`
  → `interactionResolveTarget` → `interactionResolveLaw` → `InteractionValidated`
  → law rules — instead of the legacy `ActionValidated`/`originalPayload` path.
  `itemContainment` and `affordanceUse` now listen on `InteractionValidated`
  and resolve their container / instrument through the unified
  `resolveInteractionTarget`; an ambiguous container or instrument returns
  `ActionRejected { reason: "ambiguous_target", candidateNames, candidates }` instead of
  the legacy `.find()` self-selection. The unified resolver now also exposes
  carried items to the player for `place`/`use`, so a carried object to place
  (or a carried instrument) is resolvable and two same-named candidates are
  honestly ambiguous. Files: `types.ts` (InteractionVerb + goal/manner on
  InteractionCommand), `deterministic-interpreter.ts` (canonical place/use +
  buildCanonical/buildInteractionCommand carry goal), `intent-proposal*.ts`
  (place/use in interactionVerbs, out of LEGACY_OPERATIONS, goal/manner
  carried), `command-handler.ts` + `world-interaction.ts` (goal/manner
  threaded through the chain), `target-resolver.ts` (carried candidates),
  `action-capability.ts` (both rules migrated). Tests migrated/added in
  open-intent.test.ts, action-capability.test.ts (P2 ambiguity tests),
  target-resolver.test.ts (carried place/use + closed-container non-candidate).
  `interaction-force.test.ts` (apply_force/observe) is unaffected because
  those verbs stay legacy. Full `npm run validate` PASS. Changes remain
  uncommitted, unpushed and undeployed.

- P1 fix: natural-language `place`/`use` commands now reach the action-capability
  rules with correct structure. The deterministic interpreter previously put the
  whole phrase remainder into a single `target`, so «положить камень в сумку»
  produced no `secondaryTarget` and «использовать факел чтобы зажечь траву»
  produced no `instrument`/canonical `goal`. The fallback tail now splits `place`
  into target + secondaryTarget (container prepositions «в/во/внутрь») and maps
  `use` goal clauses to canonical Affordances via a new Russian verb vocabulary
  (ignite/illuminate/tie/secure/strike/repair/...); unmapped goals stay raw and
  the world rejects honestly. Verified end-to-end:
  interpretIntent → handleCommand → InteractionRequested →
  InteractionTimeValidated → TargetResolved → InteractionValidated →
  itemContainment/affordanceUse emit ItemMoved / ItemUsed. Validation PASS
  (intent-parser 192 tests, world 745 tests, full `npm run validate`).
  Changes remain uncommitted, unpushed and undeployed.
- P1 fix: hidden `ConsequenceCreated` no longer leaks to the player. The Belief
  boundary already treats it as an internal scheduling event
  (packages/world/src/observation/builder.ts:405), but Presentation surfaced a
  notable card with the consequence type and its expiry tick, which reached the
  chat-feed. Now the `consequence_created` PresentationTemplate returns null,
  `formatEvent` no longer narrates it, the game-shell activity classification
  and the observer-thread definition start only from the visible manifestation
  (`AudacityTriggered` / `ConsequenceFired`), and the discovery collectors no
  longer treat ConsequenceCreated as observable "omen" evidence. Regression
  tests updated in selector/narrative/observer-threads/game-shell. Validation
  PASS (125 files, 1544 passed, 1 skipped).
- P2 fix: narrative LLM responses now pass a deterministic structural guard, not
  just a prompt instruction. `narrateTurnLLM` and `narrateLLM` require a
  structured JSON contract ({narration, claims[]}), where every narration
  sentence must reference the input fact id it derives from and declare an
  epistemic class no stronger than that fact's class
  (packages/world/src/narrative-llm.ts: `verifyEpistemicNarration`). A
  testimony or interpretation can no longer be presented as an established
  fact; violations (class_upgrade, unknown_source, invalid_json, missing/
  unexpected_claims) fall back to the deterministic template with a
  `epistemic_violation:<reason>` fallbackReason. Export guards
  `parseStructuredNarration`, `verifyEpistemicNarration`, `isEpistemicClass`,
  `epistemicStrength`. New pure tests for the guard plus integration tests for
  both adapters. Validation PASS (125 files, 1544 passed, 1 skipped).
- P2 fix: `canContain` now counts the total mass of nested container contents.
  Previously it summed only the direct `mass` of immediate contents
  (packages/world/src/action-capability/capability.ts), so a container of mass
  1 with a stone of mass 4 inside could fit into a container of capacity 2.
  New pure helper `getTotalMass` recursively sums an item's own mass plus all
  its container contents (cycle-guarded); `canContain` uses it both for the
  used mass and for the placed item. `itemContainment` now rejects placing a
  loaded container into an overloaded container. Two regression tests added
  (pure `canContain` + full rule path). Validation PASS (125 files, 1540
  passed, 1 skipped).
- P2 fix: the human playtest gate no longer accepts formally empty evidence.
  `validateAdventurePlaytestReview` (packages/cli/src/acceptance/
  playtest-review.ts) now takes an injectable `PlaytestReviewRuntime`
  (`currentCommitSha`, `fileExists`, `readFileText`, `readFileSignature`,
  `validModels`, `validProviders`; default pins to git HEAD, the working
  directory and the live LLM config). It requires `gameplayCommands` 1–35
  (rejects 0), matches `scenarioCommitSha` against the runtime commit,
  requires at least one `desktop` and one `mobile` screenshot path, and
  rejects any `blockedChecks`. Evidence content is now verified, not just
  existence: the deterministic report must parse as JSON and conform to the
  AdventureReport schema (pass=true, all numeric/boolean/array fields),
  DOM notes must be a non-empty text file with ≥40 characters, every
  screenshot must carry an image extension AND real image magic bytes
  (PNG/JPEG/GIF/WebP, so `desktop.txt` stubs fail), `browserTaskId` must be
  a task id, and `model`/`provider` must be configured values (placeholder
  tokens and dummy labels fail). Default runtime exported as
  `defaultPlaytestRuntime`. Test suite expanded from 15 to 22 cases covering
  empty evidence, SHA mismatch, missing artifacts, blocked checks, fake
  screenshot paths, text-file screenshot stubs, empty/invalid/non-conforming
  report JSON, stub DOM notes, placeholder task id and placeholder model/
  provider. Validation PASS.
- P3 doc sync: operational docs now match Git. CODEX_HANDOFF header no longer
  claims the final runtime commit is `4c2b137` with a clean main; it states the
  runtime commit is `4c2600e70dcb931024cbf3077f985ff90949e6ba`, `HEAD` equals
  `origin/main` (both verified), and the working tree carries uncommitted
  P1/P2/P3 changes. `docs/simulation/registry.yaml` `lastUpdated` advanced to
  `2026-08-14` (was 2026-08-05). Canon/simulation validation unaffected.
  `docs/acceptance/full-adventure-evidence-2026-08-13.md` keeps its pinned
  `4c2b137` snapshot because it is a dated evidence record, not current-state
  documentation.
- P1 fix: the epistemic guard now enforces a structured, non-authoritative
  narration boundary. Every claim must reference a known source fact and may
  not strengthen its epistemic class; once source facts exist, the returned
  narration is assembled only from validated claims, never trusted from the
  model's free-form narration field. Weak classes receive deterministic source
  framing (testimony, inference, interpretation), while the certainty marker
  check remains a conservative supplemental rejection for overclaiming wording.
  Regression coverage includes the Russian «Достоверно установлено» bypass and
  an unclaimed extra proposition. Validation PASS (33 narrative tests).

- Follow-up hardening after review: weak epistemic claims are rendered with
  deterministic source framing (testimony, inference, interpretation), so
  unlisted certainty wording cannot become an unqualified world fact. The
  guard also covers the Russian formulation «Достоверно установлено».
  The playtest report verifier now reuses the AdventureReport acceptance
  thresholds and rejects pass=true reports with missing beats, failed replay
  invariants or empty metrics. Ambiguous same-named targets preserve every
  player-facing candidate description in the ActionRejected payload without
  exposing internal ids. Focused and full validation pass; changes remain
  uncommitted, unpushed and undeployed.

## Current work (2026-08-13)
- Observer-map and world-cutover hardening from the review: detail artwork is no longer reachable through guessed public asset URLs; unlocked descriptors and scoped detail route are server-owned; map requests reuse the projected spatial read view. Bidirectional journey observations preserve direction and interruption coordinates; relation knowledge keeps the strongest partial/full progress. Route hints reach deterministic route selection and LLM confidence is range-checked with low-confidence clarification. Resource extraction now requires the authored location and natural "take" aliases map to the existing extraction command. World cutover now preflights the bundle and atomically creates/promotes/succeeds the new world in one SQLite transaction.
- Full-adventure acceptance (ADR-0031) now covers the 15-beat adventure contract: living-region entry, AI-DM conversation, authored rumor, intentional goal, multi-tick route, route alternative, changed river/crossing, consequential discovery evidence loop, return/map growth, 24 autonomous ticks, re-entry and restart/replay chronicle. `npm run acceptance:adventure` passes with 4 meaningful choices, 4 completed journey legs, 4 world changes, 4 discovery advances, 3 map-knowledge growth steps, 90 offline meaningful events, chat alternation, replay purity, idempotency and restart persistence.
- Validation: `npm run validate` PASS (122 files, 1454 passed, 1 skipped), including Canon, Simulation, 10 eval scenarios, full-adventure acceptance and diff checks. Changes remain uncommitted, unpushed and undeployed.
- Live 30–60 minute browser/AI-DM proof is intentionally separate and remains BLOCKED: the fixed NTFS browser task can read the deployed production menu baseline but reports the existing presence-load error; the current worktree server on port 3010 returns `ERR_CONNECTION_REFUSED` from that browser task. No live-play success is claimed until a browser-accessible staging/deployment is authorized.

# Current work (2026-08-11)
- Observer-scoped Pilot Region map and progressive journeys completed (ADR-0030): server-owned ObserverSpatialKnowledge and map DTO v3 with revealZones/availableDetails are wired with withheld coordinates, detail coverage/unlock policy, and route geometry clipped to physically traversed prefixes. Journeys advance one deterministic tick at a time, can be interrupted by voice, never progress during offline ticks, and reveal destination only on completion. The browser client accepts v3 DTOs and keeps command controls visibly pending through fast responses. Validation: npm run validate PASS (122 files, 1442 passed, 1 skipped). Commit, push and production/browser re-verification are next.

- Production world entrypoint implemented (ADR-0029): SQLite schema v6 adds primary/succession tables; `world:cutover` creates and verifies an isolated `riverwatch-main` from `living_region`; `/api/continue` and unscoped gameplay resolve the primary world; superseded routes return 410 and browser redirects to the replacement presence entry. `npm run validate` PASS (121 files, 1428 passed, 1 skipped). Changes remain uncommitted, unpushed and undeployed.

- Conversation shell restored in the working tree (ADR-0024 amendment): the main surface now uses the two-voice `#chat-feed`; gateway clarifications render as transient Master replies; top navigation is Map / You / Knowledge; Dev and the separate discoveries overlay are removed from the player shell. Full validation PASS (118 files, 1422 passed, 1 skipped). Fixed NTFS browser QA PASS for the static shell at localhost:3010 on desktop/mobile widths; actual mounted Game Shell/Map runtime remained BLOCKED because the read-only budget forbade Presence acknowledgement and the local database had no entered world. Changes remain uncommitted, unpushed and undeployed.

## Current work (2026-08-09)

- AI-DM Interpretation Gateway implemented (ADR-0028): deterministic fast path plus bounded LLM IntentProposalV1 fallback. Proposals are schema/capability validated into existing transient commands; model authority fields, hidden IDs and compound intent execution are rejected. Clarifications return before the world queue with no Domain Events or TickPassed; HTTP and main shell render the clarification as a player-facing response.
- Added proposal and gateway tests; current validation after this milestone: npm run validate PASS (118 files, 1421 passed, 1 skipped). Changes remain uncommitted, unpushed and undeployed.


- Historical evidence layer implemented (ADR-0027): accepted physical traces for ancient culture, abandoned infrastructure, possible conflict damage, forest/climate shift and former river course; runtime discovery definitions require independent evidence and expose supported/contradicted/inconclusive read-side resolution.
- Resource node vertical slice implemented (ADR-0026): accepted Blackwood timber definition is compiled into bootstrap, projected with integer stock, supports extraction, depletion, deterministic world-time regeneration and blocking situations; command handler and RuleRegistry are wired.
- Region compiler/runtime genericization implemented: --region, --all and catalog checks; runtime loads generated bundles by region ID through region-catalog.json; pilot wrappers remain compatibility APIs.
- Validation after this milestone: npm run validate PASS (115 files, 1402 passed, 1 skipped); Canon and region authoring checks PASS. Changes remain uncommitted, unpushed and undeployed.

- A cohesive premium game interface is implemented in the working tree across the main menu, new-game journey, return screen, focused game HUD, Context, Chronicle, Discoveries, loading/error states and mobile layouts.
- Context now has a dedicated Map tab rendered from observer-scoped SVG/vector data. The reference artwork is authoring-only; runtime consumes only `ObserverMapDTO` from `/api/worlds/:id/map`.
- Deterministic fog of war reveals only the observer, traversed/observed/glimpsed locations and observed paths. Rumored locations create no marker, reveal or `knownArea` expansion, so hidden geometry never reaches the normal player renderer.
- Multi-world shell wiring now loads and unwraps the map endpoint independently from the game-shell snapshot, with an honest unavailable state. Desktop and mobile width constraints keep the full map inside the Context dialog.
- New-game rendering exposes an accessible three-step progress indicator (Hero / World / Beginning) without changing creation semantics.

- Image -> Canon pipeline implemented for the pilot region (ADR-0025): reference artifact manifest with exact SHA-256, normalized visual observation layer, proposed hypotheses/resources, human review, deterministic compiler projection and versioned pilot-region.v5.json bundle with region/content/discovery/simulation definitions and object provenance. Bootstrap begins with CanonGenesisRecorded and carries canonicalRefs/digests in payload provenance. Canon validation fails on stale compiled output; proposal-only waterfall/resource/hypothesis items are excluded from runtime.
- Runtime no longer reads region artwork: the public PNG/JPG/WebP assets and image-backed map foundation were removed. ObserverMapDTO v2 exposes only bounded knownTerrain vector patches; map SVG renders those patches under the existing fog mask.
- Full `npm run validate`: PASS (112 files, 1392 passed, 1 skipped), including typecheck, Canon, simulation, eval and diff gates.
- Local NTFS browser QA: PASS at 1440x960 and 390x844. SVG artwork, fog mask, 3 reveal circles, 2 corridor paths, observer scope, focus trap, Escape/opener restore, responsive overflow and zero console warnings/errors were verified; gameplay commands: 0 and worldTime remained T0.
- Changes are not committed, pushed or deployed.


Mutable milestone note. Git, tests and current source outrank this file.

## Current state (2026-08-08)

- Branch: main (== origin/main at `f9c845d`, deployed `4183a58`). Working tree
  carries UNCOMMITTED P2 fixes below (narration scheduling, touch targets,
  modal focus trap) — not yet committed or deployed.
- ADR-0024 / UX-7 "Chat & Chronicle interface" — COMPLETE, COMMITTED and
  DEPLOYED (`871917a` + narration fix `4183a58`), `npm run validate` PASS.
  Browser QA still pending (NTFS thread; see Next #0).
  - UX-7.1: main Game Screen is a vertical chronicle of player intentions and
    world answers (`chat-feed-view.js`, `#chat-feed`); suggestions stay in the
    DTO and are never rendered as chips (per ADR-0024 point 2). Session-scoped
    intent bubbles — a PlayerCommand is not a Domain Event.
  - UX-7.2: activity and causal panels moved off the main centre-column into
    context-rail tabs (Вокруг / Почему); the chronicle dominates the screen.
  - UX-7.3: two-voice narrative pacing — player bubble (ТЫ) vs world answer
    (МИР + Ход N header), discovery-mark chip, feed styles.
- Persistent literary turn narration (ADR-0024 MIR voice), DEPLOYED:
  - `packages/world/src/narrative-llm.ts` `narrateTurnLLM` — non-authoritative
    read-side decoration (AGENTS §4): rephrases only deterministic
    Presentation facts (turn primary + up to 3 notable, never background),
    emits no Events, writes no Projection. Returns `TurnNarration {text,
    model, usedFallback, fallbackReason, latencyMs}`.
  - Persistence schema v5: `turn_narrations` table (PK world_id+world_time,
    INSERT OR IGNORE), `migrateV4ToV5` wired into fresh/v1/v2/v3/v4 chains,
    `user_version` 5 verified on the live DB.
  - `/api/command` (online + offline-accepted paths) generate narration
    best-effort after the deterministic turn; journal merges only
    `usedFallback === false` narrations (`attachTurnNarrations`).
  - Client renders the narrated line in the chronicle (`.chat-world-narrated`,
    italic gold) above the template primary.
  - FIX `4183a58`: the original verbose DnD system prompt exhausted the
    provider's reasoning token budget (finish_reason=length, empty content,
    `empty response` → silent `chat_error` fallback). Compact prompt now
    yields prose within budget. Verified LIVE 2026-08-08 on Жора
    (world-msjeemf2-1-44xf6oisyo2): `look around` → HTTP 200 in ~12s,
    journal `narrativeLLM` with `usedFallback:false`, model
    the then-configured static emergency model, latency ~12s; DB row
    `used_fallback=0`.
    Fallback narrations are correctly never surfaced in the journal.
  - P2 fix (uncommitted): `wait` and `advance N` bypassed the new narration
    (both branches early-returned before narrateTurnLLM). Now narration is
    scheduled detached via a per-world `NarrationScheduler` (capped, serialized,
    never holds the command queue): online command / wait / offline paths each
    narrate the single turn; `advance N` narrates every tick (each tick is its
    own chronicle turn keyed by its own worldTime, so a single presentation
    cannot cover the batch). `turn_narrations` upsert now overwrites a stored
    fallback row so a later successful generation is never INSERT-IGNORED.
  - P2 fix (uncommitted): empty LLM reply was wrongly treated as `ready` —
    `markReady()` ran before the text check, deleting the runtime status with
    no persisted row, so the journal recomposed the turn as `not_requested`
    and the browser stopped polling as if prose was never asked for. The
    shared settle rule `shouldPersistNarration()` (used in BOTH the
    interactive and the `advance N` batch branch) now requires a non-empty
    `usedFallback=false` text; empty/fallback results recompose as
    `unavailable`, and `markReady()` runs only after the row persists.
  - P2 rework (uncommitted): the old fixed-timeout client refresh is replaced
    by server-driven polling — `public/narration-poll.js` + `app.js` read the
    journal's per-turn `narrationState` (`pending`/`ready`/`unavailable`/
    `not_requested`, decided in `resolveNarrationState`); the poll sleeps on
    `pending`, stops on the three terminal states, re-arms safely per command
    (generation-guarded, never two timers) and a 150s watchdog only guards a
    wedged poll. `/narration-poll.js` added to the HTTP static whitelist.
    ADR-0024 amended to surface the journal DTO lifecycle deviation.
  - Tests: world narrate-turn.test.ts 7, journal-narration.test.ts 3,
    CLI turn-narrations.test.ts 9 (persistence + `shouldPersistNarration` +
    empty-recompose regression), narration-scheduler.test.ts (bounded runner),
    narration-poll.test.ts 6, plus client-modules + server module-graph gates.
    Full `npm run validate` PASS.
- P2 touch-target fix (uncommitted): Known Worlds menu CTAs were below the
  44 px target minimum — «Открыть новый мир» measured 39.19 px
  (`menu.css .menu-secondary-btn`), «Вернуться» 26.25 px
  (`presence-entry.css .presence-card-enter-btn`). Both rules now set
  `min-height/min-width: 44px`, matching the Presence CTAs
  (`presence-ack-btn` / `presence-continue-btn`); same applied to
  `menu-primary-btn`. Browser QA for the Known Worlds screen still pending
  (NTFS thread).
- P2 modal focus fix (uncommitted): `aria-modal="true"` overlays
  (journal / discoveries / dev via `openShellOverlay`, plus shell-loading,
  shell-error, exit-overlay and the presence-entry dialog) now keep keyboard
  focus: background siblings get `inert` while a dialog is open
  (`refreshBackgroundInert`, `#app [role=dialog][aria-modal=true]:not([hidden])`)
  and the global keydown handler traps Tab/Shift+Tab within the dialog
  (`trapFocus`), in addition to Escape closing. Restores the opener element's
  focus on close (`closeShellOverlay`); the exit overlay synchronizes inert via
  `syncShellModalInert()` in presence-exit-controller.js. Browser QA for
  keyboard focus still pending (NTFS thread).
- Old module graph served; `/chat-feed-view.js` added to the HTTP whitelist.
- Playable v0.2 (`59cec34`, deployed): `journey.travel` unlocks travel to named
  destinations (verified live waypoint→city, 3 destinations), the observer
  checkpoint `updated_at` is monotonic (`1aa4950`).

_HISTORICAL (2026-08-07 snapshot, superseded by Current state above): branch was
clean == origin/main, deployed 7b83302; UX-6.3.1 is COMMITTED (72d997c, before
0958407) and has been live since the 0958407-era deploy — the five fixes (44px
presence CTA, Focus Tab order, T0 shell-loading cover, graceful-exit
duplicate_request handling, raw-key label humanization) were verified live.
This superseded the earlier stale note that claimed UX-6.3.1 was "uncommitted"._

Recent architecture base (all deployed): Simulation Evaluation Framework
(ADR-0022), Simulation Bible living-process catalog + 10 vertical scenarios
(ADR-0023: risk→fire Deferred), player experience visual report, pilot region
vision canon (visual-canon.json), and "establish pilot region initial
simulation state v0.1" (southern_borough + enriched initial observations).

_The last five deploys before the UX-7 milestone (6a41ca7, 9b85d12, 2481d85,
4bea92a, 7b83302) were docs/eval/backend-region; browser UI later changed for
ADR-0024/UX-7 (chronicle + rail tabs + narration, deployed 4183a58). Browser
re-QA of the UX-6.3.1 fixes is covered by Next #0/#1._

## Current milestone

First living region slice (ADR-0014) — COMMITTED (`0958407`, then travel in
`59cec34`), NOT the active next-step. It delivered the deterministic 20×20 km
region compiler, 6,400 terrain tiles, 400 simulation cells, spatial replay
projection and the observer-scoped `/map` endpoint; it does not expose hidden
geometry. Note the slice scope statement "adds no travel Rules" referred to
ADR-0014 itself; travel to named destinations then landed as its own commit
(`59cec34`, playable v0.2, verified live). The active milestone is ADR-0024 /
UX-7 chronicle + narration (see Current state above); next steps are in Next.

UX-6.3.1 "UI hardening" — COMPLETED. The five application defects from the
last NTFS browser QA run are fixed, committed as 72d997c (before 0958407) and
live on the deployed server since the 0958407-era deploy. Verified live
2026-08-07 (server 7b83302):
1. «Осмотреться»/«Войти» has a 44px touch target and full-width mobile layout
   (presence-entry.css: `.presence-continue-btn` min-height/min-width 44px).
2. Focus Tab order: `presence-entry-controller.js` handles Tab/Shift+Tab —
   Tab from the phase title lands on «Я здесь»/«Осмотреться»/retry, Shift+Tab
   returns to the title.
3. No T0 shell flash: `connect()` shows `#shell-loading` from its first
   synchronous line until snapshot + journal + discoveries render.
4. Graceful exit: `presence-exit-controller.js` treats 409 `duplicate_request`
   as an already-recorded exit (clear pending + lease, `skald:exit-ready`, no
   «Не удалось зафиксировать точку возвращения.»).
5. No raw keys: templates/narrative emit humanized labels; verified live
   («Местная община», «Лесной пожар», «Помощь»).
- Tests: narrative.test.ts label coverage; presence-entry-view.test.ts (+6:
  44px CTA CSS + mobile width, tab title→action hop, Shift+Tab return,
  shell-loading boot coverage, exit duplicate_request → exit-ready).
- Pending: NTFS browser re-QA of the five fixes on the live system (dispatch
  prompt prepared; actual run happens in the fixed NTFS thread). The last five
  deploys contained no browser-client changes by design (docs/eval/backend
  region), so the UI look is intentionally unchanged since 0958407.
- Verification 2026-08-07 (server 7b83302, worldTime 283; API + static asset
  inspection, browser unavailable from WSL task): Fixes 1-4 PASS (deployed,
  structurally correct: 44px CTA CSS + mobile override; Tab trap in
  presence-entry-controller; setShellLoading + #shell-loading element; exit
  duplicate_request handler). Fix 5 PASS (API-verified: belief displayName
  humanized — observation:risk_taken → «Тревожный след», wall_caution →
  «Память преграды», relation:guild → «Связь с другим»; journal humanized;
  patternId never rendered as display text). Visual/DOM rendering of fixes
  1-4 and the Knowledge tab still requires a real browser: BLOCKED (NTFS
  thread 019fa52b-… not reachable from the WSL task via opencode CLI); the
  dispatch prompt is prepared and queued.

First living region architecture — accepted in `docs/LIVING_WORLD_REGION_ARCHITECTURE.md` and ADR-0012. It separates backend
spatial truth from observer-scoped map knowledge, defines Event-bootstrap
authority, 20×20 km pilot resolution, process-driven spatial simulation,
fog/discovery, first entry, living-map updates and continent-scale boundaries.
RUNTIME IMPLEMENTED: the ADR-0012 spatial-compiler authority is live in the
ADR-0014 slice (region compiler/`SpatialProjector`/`buildObserverMap`),
committed `0958407` + `59cec34`; spatial *processes* (weather/river/settlement
read views) are separate later slices and are still documented-only.

Interaction Model v1 — stages 0–2 + Slices 1–2 (ADR-0013, DECISIONS D-020)
— COMMITTED (`72d997c`); this handoff note is retained for history only.
Remaining Slices 3–7 are the active next work (see Next #3):
- Stage 0 docs: ADR-0013 written (context/alternatives/decision/7-slice
  table/DoD), `docs/WORLD_INTERACTION_MODEL.md` promoted v0 draft → accepted
  v1 contract, `docs/ux/INTERACTION_GRAMMAR.md` registers the v1 intentions,
  GLOSSARY gains InteractionCommand/InteractionVerb/TargetResolution/
  ambiguous_target, UX_ROADMAP slots UX-6.3.1 between UX-6.3 and UX-6.4.
- Stage 1 pipeline convergence: `IntentCommand` renamed `InteractionCommand`
  (never an Event); `InteractionVerb` fixed set
  observe/inspect/listen/touch/take/open/apply_force/give; parser yields
  canonical commands for RU stems with ё→е normalization, softener
  stripping («попытаться открыть сундук»), give item/recipient split,
  compound-intent rejection («Одна команда — одно намерение.»), confidence
  rounding; the English `examine|inspect` regex also parses canonical.
  `command-handler.ts` routes InteractionCommand → InteractionRequested with
  a registry gate; CLI guards (index.ts + world-handlers.ts) and
  `perceptionExamine` migrated to the canonical verb.
- Stage 2 shared Target Resolver (ADR-0013 §3): `resolveInteractionTarget`
  over ReadonlyWorld — grid entities must be nearby (Manhattan ≤ 1),
  WorldObjects must be in the player's current location; exact name/alias
  beats partial, partial only when it selects a single candidate, two equal
  → `ambiguous` with player-facing candidate names (never internal IDs);
  observe/listen without a target → `environment`. One resolver serves the
  runtime gate, the offline classifier and the HTTP/integration tests.
  `InteractionTarget` is a pure adapter (`targetFromEntity`/`targetFromObject`)
  over Entity/WorldObject; `WorldObjectPlaced` gained an optional
  `aliases` field («пепел» for «Кучка пепла») read by the object
  projector (additive, replay-safe).
- Slice 1 observe+inspect: RU observe stems (осмотреть/осматриваю/
  рассмотреть/оглядеть/посмотреть/взглянуть/проверить/…) →
  canonical `observe`; изучить/изучаю → canonical `inspect`; conjugation
  remnants stripped deterministically («осматриваю дверь» → дверь).
  Registry registers observe+inspect (law perception). Gates handle
  WorldObject targets and the environment fallback
  (TargetResolved { environment: true, locationId } →
  InteractionValidated { law: perception, locationId }). New
  `rules/interactions/perception.ts` (`perceptionObserve`): inspect/observe
  with an entity → EntityExamined, with an object → ObjectObserved,
  observe without a target → surroundings ActionResolved. Command Handler
  accepts observe without a named target; other verbs still require one.
  Offline classifier stays inspect-only (ADR-0013 §7) — «изучить петли»
  now parses to inspect and works offline.
- Tests: intent-parser 145 (observe/inspect canonical forms, legacy-kept
  listen/touch/apply_force/heat, compound rejection, remnants); world
  target-resolver.test.ts 16 (exact/alias/partial/ambiguous/missing/
  environment/location-scope), perception.test.ts 10 (object target,
  environment chain, full chain end-to-end), world-interaction.test.ts 11,
  critical-checks + interaction-force updated for `WorldObject.aliases`;
  full `npm run validate` PASS (74 files / 1101 tests).
- Slice 2 listen: RU listen stems (слушать/прислушаться/прислушать/
  подслушать/вслушаться/вслушать/прислушива/слуш) → canonical `listen`;
  `InteractionLaw` union grows to `"perception" | "listening"`; Command
  Handler accepts listen without a named target. New
  `rules/interactions/listening.ts` (`listeningListen`): environment listens
  scan `location.objectIds`, an object with temperature > `TEMPERATURE_HOT`
  (60) crackles `SoundObserved { sourceId, source, description, loudness:
  "quiet", distance, locationId }`, everything else is honest
  `ActionHadNoObservableEffect { reason: "silence" }`; concrete targets:
  hot object → SoundObserved, cold/heatless entity → `reason:
  "silent_target"`; hidden cause never revealed. `SoundObserved` added to
  event-types, narrative, game-shell builder and presentation
  (`SOUND_OBSERVED` + silent-target `ACTION_HAD_NO_OBSERVABLE_EFFECT`
  templates). Tower alias «окна» added for «Разбитое окно».
- Tests (Slice 2): intent-parser 148 (listen canonical forms incl.
  «прислушаться у окна»/«слушать звуки»/bare «прислушаться»; legacy test
  now uses touch), world listening.test.ts 11 (environment silence, hot
  object audible with loudness/distance, cold/hot concrete targets, grid
  entity Manhattan distance, non-listening-law ignore, command handler, two
  full chains end-to-end); focused runner
  `C:\Temp\opencode\slice2.test.sh`; full `npm run validate` PASS
  production HTTP + SQLite restart integration (3 tests), legacy composition
  root compatibility, SoundObserved → Belief Model coverage, and terminal
  projection coverage; full `npm run validate` PASS (76 files / 1122 tests,
  1 pre-existing skip).

UX-6.3 "Offline Intent Queue & Conflict Resolution" — first vertical slice
(deployed as 428072d, production smoke T218→T228 PASS):
- ADR-0011 `docs/adr/0011-offline-intent-queue.md` (accepted) + DECISIONS
  D-018 + GLOSSARY (Offline Intent Envelope, Base Revision, Offline Intent
  Resolution). Browser stores only a Command envelope
  `{ input, idempotencyKey, baseRevision }`; the server re-runs the Intent
  Parser and classifies `accepted | rejected | conflict | already_processed`;
  only accepted executes the normal command cycle; conflicts are text; no
  auto-rebase, no silent merge, no local Domain Events.
- `packages/world/src/offline-intent/{types,classifier,index}.ts`: pure
  deterministic `resolveOfflineIntent(envelope, { events, world, parsed })`
  — replays the event prefix up to `baseRevision` through WorldProjector,
  compares target resolvability between base and current world with the
  shared `findExamineTarget` predicate (extracted from the examine gate so
  classifier and Rule can never diverge). Frozen DTOs, no internal
  identifiers in player-facing text.
- API: `POST /api/worlds/:worldId/offline-command` (400 invalid envelope /
  415 / 405 / 404 / 503; `already_processed` uses the durable
  `processed_keys` table, restart-safe). Accepted responses carry the full
  command-cycle payload (events, state, presentation, shellDelta,
  observerThreads + delta).
- Browser: `offline-queue.js` (localStorage envelopes per world, bounded at
  20, dedupe by idempotencyKey, DOM-free + node-testable), `submitOfflineEnvelope`
  in world-api-client.js, `#offline-banner` in the command dock; on transport
  failure the composer saves the envelope, on (re)connect `flushOfflineQueue`
  re-submits, accepted → refresh shell/journal/discoveries, rejected/conflict
  → server text, transport failure → remaining queue waits.
- Tests: world `offline-intent.test.ts` 11 (accept/reject/conflict/
  invalid_envelope matrix, base-vs-current replay, determinism, frozen DTO,
  no leaks); CLI `offline-intent-http.test.ts` 9 (400s, accepted + executes
  EntityExamined, already_processed incl. restart durability, rejected
  unsupported/no_such_target, conflict via crossroads world where the player
  moved away, 405); `offline-queue.test.ts` 9 (parse/trim/enqueue/dedupe/
  bound/remove/degradation). NOTE: with the current rule set an examine
  target can only vanish if the player moves (grid worlds) or future events
  remove entities — conflict classification is live and tested, the second
  living process («следы чужого присутствия») will make it reachable
  organically. «осмотреть <объект>» RU forms are Interaction Model v1
  (next), the slice is exact English `examine <object>`.
- UX-6.2.1 hardening (deployed 5f95eeb): incompatible checkpoints handled
  explicitly by `buildObserverThreadDelta` — a checkpoint that presence
  resolves as `incompatible` is no memory at all (empty delta, current
  threads treated as a fresh reconstruction); CLI call site passes the
  resolved `checkpointState` through. 4 regression tests: no false `changed`,
  no false `resolved`, no offline-event leak (fully offline fire playthrough
  yields an empty journal and delta, no event names in the DTO), and the
  delta/journal match the missing-checkpoint result. Dependency audit
  classified (see Next #3).
- ADR-0010 `docs/adr/0010-observer-active-threads.md` (accepted, 10 points)
  + GLOSSARY terms (World Process, Observer Thread, Thread Evidence, Known
  Lifecycle, Knowledge State, Re-observation, Observer Thread Journal).
- `packages/world/src/observer-threads/{types,definitions,builder,delta,index}.ts`:
  pure deterministic thread journal. Definitions map existing presentation
  thread keys to lifecycle signals: FOREST_FIRE (`situation:forest_fire`,
  start ForestFireStarted/SituationStarted, develop TreeBurned, resolve
  SituationEnded), GENERIC_SITUATION (`situation:*`), CONSEQUENCE
  (`consequence:*`, resolveEventTypes: [] — TODO: no visible completion
  signal exists, so consequences never claim an ending). `ref =
  fnv1a("observer-thread:v1:"+key)` → `ot-<base36>`, raw keys never in the
  player DTO. Aging observed → remembered (≤3) → uncertain (4+);
  `knownLifecycle` (active/resolved/unknown) and `knowledgeState` are
  orthogonal; memory only from a `valid` observer checkpoint.
  `buildObserverThreadJournal({events, beliefModel, checkpoint,
  checkpointState, revision})` — checkpointState is a required caller input;
  `buildObserverThreadDelta({events, journal, checkpoint, checkpointState})`
  → opened / changed / resolved / becameUncertain; incompatible checkpoint
  is treated as no memory (UX-6.2.1).
- HTTP: `GET /api/worlds/:id/observer-threads` (200/405/404/503),
  `/observer-session` gains `threads` (same revision as session),
  command/wait/`advance N` responses gain `observerThreads` +
  `observerThreadDelta`; `/game-shell` snapshot gains `observerThreads`;
  `WorldPresenceSummary` gains `uncertainThreadCount`/`changedThreadCount`
  (card hint «Некоторые из твоих сведений могли устареть.»).
- Browser: «Активные нити» panel — 4th context tab + `threads-view.js`
  (DTO-only cards, montage tags «Новая нить»/«Изменилось»/«Завершилось»/
  «Требует проверки», honest labels «Есть противоречие»/«Эта нить требует
  нового наблюдения.», evidence with turn numbers, no buttons/chips), mobile
  nav button, registered in http-server.js jsFiles.
- Tests: world `observer-threads.test.ts` 26 + `observer-thread-delta.test.ts`
  9 (classification determinism, aging, offline hiddenness, never resolves
  from a hidden end, caps MAX_THREADS 8 / MAX_EVIDENCE 3 /
  MAX_RECENTLY_RESOLVED 3, no internal-id leaks, replay, deep-freeze);
  CLI `observer-threads-http.test.ts` 10 (uses in-process legacy-template
  worlds — HTTP worlds are location-based where "move north" is blocked and
  no fire can start; full playthrough: 3 moves → audacity t8 → move t9 →
  fire t14; waits advance exactly 1 tick, spread burns at even offsets);
  `threads-view.test.ts` 7 (DOM-mock renderer tests); client-modules +
  game-shell/http integrity additions. Full suites: world 28 files / 437
  tests, CLI 28 files / 376 tests (1 pre-existing skip).

## Completed

UX-6.2.1 hardening: `buildObserverThreadDelta` treats `checkpointState ===
"incompatible"` identically to a missing checkpoint — no remembered
baseline, no comparison against corrupted memory; regression tests cover
false `changed`/`resolved`, offline-event non-disclosure and equality with
the no-checkpoint result. Dependency audit classified (see Next #3).

UX-6.1 "Presence Lifecycle Completion" (commits through 76f609c, deployed
to Orange Pi: update + backup/integrity + 948 tests on-device + health/state
+ lifecycle smoke + idempotency edges PASS): atomic Entry DTO, entry state
machine with explicit «Осмотреться»/«Войти»/«Я здесь», lease routing
(`#/world/:id/return`), graceful exit with durable pending body, honest
phase-mapped loading texts, 6.1A-F tests.

UX-6.0D-F browser entry path (commits b9c02cd … d7ce256, deployed): Known
Worlds cards from `WorldPresenceSummary`, deterministic presence entry
reducer + view + controller, shell unlock via `skald:presence-ready`, a11y
touch-target fix (44px).

UX-6.0A-C: ADR-0009, `packages/world/src/presence/` (types, drift, builder),
SQLite schema v4 (`observer_checkpoints`, `acknowledge_requests`,
additive migration), three HTTP endpoints, offline observability filter in
the observation builder. The existing world/src/observation builder remains
the compatibility adapter consuming the canonical @skald/observation types.

Iteration 16.0 — Visual Shell: dark atmospheric game shell, contextual world stage, world/you/knowledge rail, honest activity and causal views, free-text composer only, responsive layout and generated map asset. Frontend-only; no new Domain Events, Rules, Projection or API contract changes.

UX-0 through UX-5.0B/C: product contract, open intent UI, multi-world
persistence, game shell, player guidance, and the production shell.

Iteration 15: Open Intent and Critical Checks, deployed to Orange Pi.

World Interaction Model v0 first vertical slice:
- additive entities read model from ObjectPlaced events;
- exact syntax examine <object> -> IntentCommand;
- durable gate chain InteractionRequested -> InteractionTimeValidated ->
  TargetResolved -> InteractionValidated -> EntityExamined;
- one static verb (examine) and one law (perception);
- curiosity observation side effect, Narrative/Presentation output, replay
  purity and same-tick action-budget coverage.

## Next

0. ADR-0024 (UX-7) browser QA: DEPLOYED at `4183a58` (chronicle + rail tabs +
   persistent LLM narration, verified live via API). Remaining: NTFS browser
   visual QA of the chronicle + rail tabs + narrated line (record PASS/FAIL/
   BLOCKED here). Note: each real gameplay click mutates the canonical Event
   Log, so the delegated NTFS prompt must carry an authorized click budget.
1. NTFS browser re-QA of UX-6.3.1 on the LIVE system (URL 192.168.0.5:3000,
   commit 7b83302): verify the five fixes (44px «Осмотреться» CTA, Tab from
   Focus title → «Я здесь», no T0 shell flash during acknowledge, no false
   error dialog on graceful exit, no raw `forest_fire`/`wall_caution`/`guild`
   in texts). The dispatch prompt is prepared; the actual run happens in the
   fixed NTFS thread (click budget ≤4). Desktop 1440×900 + mobile 390×844
   (mobile recorded as BLOCKED if the viewport override still does not apply).
   Optionally verify the offline banner flow. Record PASS/FAIL/BLOCKED in this
   file independently of validate. UX-6.3.1 itself is committed (72d997c) and
   deployed — no further commit is needed.
2. PILOT_REGION_CANON_v0.1 → FIRST_DISCOVERY_EXPERIENCE.md: fix the first
   game contract (draft exists at docs/worldbuilding/PILOT_REGION_CANON_v0.1.md)
   as the Discovery Contract, then write the step-by-step first-5-minutes
   experience. Afterwards add the Causal Density metric (meaningful/total) to
   `npm run eval:living`.
3. Interaction Model v1 — remaining vertical slices in order (ADR-0013 §5):
   Slice 3 touch → Slice 4 take+inventory → Slice 5 open →
   Slice 6 apply_force+critical checks (migrates interactionForce) → Slice 7
   give; each migrates its RU stems to canonical InteractionCommand, grows
   `interaction-registry.ts`, and lands in `rules/interactions/*.ts` with
   focused tests + `npm run validate`. Offline stays inspect-only until
   UX-6.4; the «осмотреть <объект>» offline promise is now partially real
   (изучить → inspect works; осмотреть → observe is online-only).
4. Second living world process «Следы чужого присутствия»: noise → tracks →
   aging → observation → hypothesis → re-observation confirms/refutes;
   exercises Observation/Belief/freshness/contradiction/Active Threads/free
   Intent/Presence; its entity life cycle will make the offline `conflict`
   resolution reachable organically (entities appearing/vanishing while the
   player is away).
5. Dependency audit (separate task, not mixed with game iteration).
   Classification completed 2026-08-02:
   - Production tree is clean: root package.json has zero `dependencies`;
     `npm audit --omit=dev` reports 0 findings. Runtime deps are only
     `zod`/`zod-to-json-schema` (packages/observation) plus internal
     `@skald/*` workspace links.
   - All 5 findings are dev-only test tooling: `vitest@2.1.9` (critical,
     advisory 1120126, fixed in 3.2.6+), `vite@5.4.21` (high, fixed
     6.4.3+), `esbuild` (moderate; installed 0.28.1 via tsx — the flagged
     range is <=0.24.2, so this entry is stale), `vite-node@2.1.9` and
     `@vitest/mocker@2.1.9` (moderate, via vitest).
   - LAN reachability: NOT reachable. `skald.service` on the Pi runs the
     Node server only; vite/vitest are never started by the service; `npm
     test` runs only during an authorized update and binds nothing. Vitest
     UI must never be exposed to LAN.
   - Fix decision deferred by design (no blind major bump): npm's only
     complete `fixAvailable` is `vitest@4.1.10` (semver-major); the
     critical alone is fixed by `vitest@3.2.6` in the current major, but
     that still resolves an affected vite unless overridden. The task must
     evaluate vitest 4 migration (Node 22 OK; CLI/config deltas) vs pinned
     vitest 3.2.6 + vite 6.4.3 override, then run the full suite (1000+
     tests) and `npm run validate` before any change is accepted.
6. UX-6.2.1 hardening is DONE (see Completed): `buildObserverThreadDelta`
   now takes `checkpointState` and treats `incompatible` exactly like a
   missing checkpoint (no remembered baseline, no false changed/resolved,
   no offline leak, delta equals the no-checkpoint result); 4 regression
   tests added.

Note: ssh from WSL to 192.168.0.5 is currently broken (lands on a stale
endpoint with user `nook`); use the Windows OpenSSH client with
`$env:USERPROFILE\.ssh\id_ed25519_skald` for Pi operations.

## Known blockers

Mobile viewport override in the NTFS browser task did not apply (requested
390×844, actual 1440×900). Desktop browser QA works; record mobile status as
BLOCKED until the browser runtime supports the override.

LLM/chat-shell vocabulary wiring for Russian free-text forms such as
"осмотреть телегу" is intentionally out of scope. Small follow-up after the
deterministic gate pipeline is accepted.


## Current work (2026-08-09, region canonicalization)

- Added the reference-only Region Interpretation Layer at
  `docs/worldbuilding/pilot-region/region-interpretation.json`.
- Added the design-time Canon concept
  `docs/canon/regions/pilot-region/visual-interpretation.yaml`.
- Added deterministic validation through
  `scripts/canon/validate-visual-canon.mjs`, wired into `npm run canon:validate`.
- Added reference manifest registration, strict visual observation/proposal/review/toponymy validation, and authoring CLI flags.
- Added generic Canon loader/IR builder and compiled bundle v5 with region/content/discovery/simulation definitions, regionVersion, digests and per-object provenance. Runtime discovery now reads accepted definitions from the bundle.
- Existing southern-borough and initial-observation bootstrap entries are recorded as already compiled; no duplicate events or image/runtime coupling were introduced.
- Gate evidence 2026-08-09: `npm run validate` PASS (112 files, 1389 passed, 1 skipped; Canon, authoring, compile check, simulation, eval and diff checks PASS).

## Current work (2026-08-24, Stage 5 narrative context hardening)

- Stage 5 read-side narrative context is implemented for the production world
  command, wait/batch and compatibility `narrative-llm` routes. The adapter
  receives replayed observer-safe facts, per-tick historical snapshots and
  character/entrypoint context; it never writes Events or Projection.
- Opening-window accounting uses persisted ConversationTurn rows of all three
  input classes (action, inquiry, clarification), with the first presence
  checkpoint required. `KnowledgeAcquired` remains observer-scoped knowledge
  and cannot be promoted to established world truth by the narration guard.
- Context-builder failures are optional read-side failures: they emit a
  structured `context_error` diagnostic and preserve deterministic gameplay.
  The player-facing legacy LLM route uses the same adapter and strips internal
  provenance. Bootstrap still contains testimony about an absent record and
  writing supplies, not a physical letter or record item.
- Evidence after hardening: full Vitest suite 140 files / 1753 passed / 1
  skipped; typecheck, shell syntax, Canon, simulation, eval, adventure
  acceptance and `git diff --check` pass. Fixed NTFS browser QA remains
  externally blocked by the unavailable browser task; no deploy was performed.

## Current work (2026-08-24, Guidance v2 observer-safe prose)

- `PlayerGuidance` now uses schema version 2 with `intentExamples` and
  navigation entries. Intent examples are deterministic, non-executable prose
  derived from an immutable `ObserverGuidanceContext`; they never dispatch
  commands, call an LLM, create Events or advance world time.
- Context is constrained to the player's observed local situation, observed
  routes, known contacts, visible/accessibly-held objects and unblocked item
  affordances. Rumored/glimpsed routes, unknown contacts, inaccessible items,
  hidden region facts and internal IDs are excluded. An authored personal hook
  is used only when profile/entrypoint context is available.
- `/api/guidance`, command/wait responses and Game Shell snapshots expose the
  same v2 read-side contract. The old `GUIDANCE_ACTIONS` registry remains an
  internal simulation/evaluation vocabulary and is not serialized into player
  guidance. Browser examples render as prose; navigation alone is interactive.
- Focused checks after migration: typecheck and 76 guidance/server/game-shell
  tests pass. Full `npm run validate` and fixed NTFS browser QA remain to be
  run/recorded for this change; browser QA is externally blocked by the known
  unavailable task.
