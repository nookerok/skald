# ADR 0024: Chat/Chronicle-first interface — the game is a dialogue with the living world

Status: accepted

## Context

The guiding metaphor of Skald is not an RPG with a command panel but a
conversation with a living world: the player discovers the laws of the world
through free-form intentions, and the world answers with facts. The product
contract already demands this — `docs/ux/UX_PRODUCT_CONTRACT.md`:
"The text composer is the primary game control. The interface must not
replace that choice with a D-pad, direction buttons, suggested-action chips
or a permanent command menu." ADR-0013 §6 repeats: "No D-pad, no verb
buttons, no action chips." PLAYABILITY_PRINCIPLES §4/§6/§7 allow hints only
as prose invitations, never as fixed action chips.

Despite this, the Game Screen grew into a dashboard: a hero stage, a
"primary/notable/background" narrative stack, activity and causal panels, a
horizontal turn-history strip, and — in an uncommitted experiment — a
**Recommendation Dock** that rendered `GameShellSnapshot.suggestions` as a
row of clickable buttons above the composer. The dock was technically sound
(fill-only, never auto-submit) but it pushed the interface toward an
interactive RPG panel: a visible list of offered actions teaches the player
"these are the options the game has", which is the opposite of "I can try
anything and the world will answer."

The dock experiment was cancelled before any commit; its diff was discarded.
This ADR records the pivot so the Recommendation Dock direction is not
re-opened accidentally and so the main screen has a normative shape.

## Alternatives

1. **Keep the Recommendation Dock as "fill-only chips".** Dropped: even
   fill-only chips are a visible action palette; they contradict the product
   contract's "no suggested-action chips" clause and the core discovery
   principle. `suggestions` remain valid *data* (UX-3 onboarding), but not a
   first-layer UI element.
2. **Full-screen minimal terminal, remove every other panel at once.**
   Dropped: too big a single step; the context rail, situation and critical
   check surfaces carry real state. Delivered as sequential slices instead
   (UX-7.1 chat core, UX-7.2 tabs, UX-7.3 narrative polish).
3. **Persist player intent text server-side so history bubbles survive
   reloads.** Dropped for now: a PlayerCommand is not a Domain Event
   (invariant 7) and must not enter the canonical log; a client-side
   persistence follow-up (localStorage per world, like the offline queue)
   remains possible without touching the log.

## Decision

1. **The main screen is a chronicle.** The central column of the Game Screen
   is a vertical feed of turns: the player's stated intention, then the
   world's response (primary / notable / background as graded text), with
   consequences visible as part of the flow. The chronicle occupies the
   dominant share of the screen; the free-text composer is the only
   permanent game control.
2. **No recommendations in the first layer.** `GameShellSnapshot.suggestions`
   stays in the DTO (backward compatibility, UX-3 onboarding), but the shell
   renders no suggestion buttons, chips or docks. First-hour onboarding hints
   may appear only as dismissible prose, never as preselected actions.
3. **Everything else is a tab or an overlay.** Map, knowledge, character,
   relations, threads, activity and diagnostics live outside the main
   chronicle surface (context rail tabs / overlays today, full extraction in
   UX-7.2). Knowledge of space is part of discovery; the map is not a HUD.
4. **No DTO, Event, Rule, Projection or HTTP contract changes.** The
   chronicle is built purely from existing read models: the journal DTO
   (history), `lastTurn` / `ShellDelta.turn` (live turns). Presentation and
   Narrative remain the only player-facing text sources.
5. **Honest limitation: intent bubbles are session-scoped.** The typed text
   of a player intention is not a Domain Event and is absent from the
   journal; the "player said" bubble is rendered from client-side session
   input only. A reload shows the world's chronicle without the player's
   exact words. Persisting intent text per world in localStorage is an
   allowed future client-only enhancement.
6. Slice plan: **UX-7.1 Chat Core** (feed renderer + composer primacy),
   **UX-7.2 Tabs** (extract map/knowledge/character/activity panels from the
   main screen), **UX-7.3 Narrative polish** (turn rhythm, "ты сделал / мир
   ответил" separation, visual pacing).

## Amendment 2026-08-08: read-side narration lifecycle is part of the journal

Point 4 said the chronicle brings no DTO changes. The executed narration work
deliberately *deviates*: the journal DTO now carries a non-authoritative
per-turn narration block (rendered line) and a `narrationState` lifecycle
field so the browser polls the server instead of guessing by elapsed time.
This is a read-side decoration contract, not a canonical one — it emits no
Domain Events, writes no Projection, and `Narrative`/`LLM` never decide for
the world (AGENTS §4). Rationale: the LLM takes tens of seconds, the command
response is bounded at ~15s, and a fixed-timeout client refresh either misses
the prose (too short) or keeps the player waiting (too long), so the DTO must
expose the per-turn `pending`/`ready`/`unavailable`/`not_requested` lifecycle.

Executed shape:
- `packages/world/src/narrative-llm.ts` — `narrateTurnLLM` (turn narration)
  and `narrateLLM` (narrative snapshot line) rephrase only deterministic
  Presentation facts; return `TurnNarration {text, model, usedFallback,
  fallbackReason, latencyMs}`.
- Read-side table `turn_narrations` (SQLite v5), keyed `world_id+world_time`,
  upserting (overwrites) so a later successful generation replaces an earlier
  stored fallback row.
- `packages/cli/public/narration-poll.js` + `packages/cli/src/runtime/
  narration-scheduler.ts` — server-driven polling and the bounded detached
  runner (interactive over batch, capped queues, drop oldest).
- Journal recomposition rule (P2): a narration only earns `ready` after a
  non-empty `usedFallback=false` row is persisted. Empty successful replies
  and fallbacks recompose the turn as `unavailable` — never `not_requested`,
  which would look (and stop the client) as if prose had never been requested.

## Consequences

- New module `packages/cli/public/chat-feed-view.js` renders the chronicle
  from the journal DTO plus session intents; `turn-history-view.js` is
  removed (its role is absorbed by the feed).
- The `#primary-section` narrative stack and the horizontal `#turn-history`
  strip are replaced by `#chat-feed`; `#situation-card` and
  `#critical-check-card` remain (they are world state, not actions).
- UX-3 guidance (`guidance` read model) is unaffected as data; any future UI
  for it must be prose-only per point 2.
- ADR-0004 (Game Shell Read Model) is unchanged: the snapshot shape stays,
  only its rendering is re-anchored to the chronicle.
- Browser-facing change: visual QA through the fixed NTFS browser task is
  required before the slice is called visually PASS (AGENTS.md testing
  rules); `npm run validate` remains the repository gate.


## Amendment 2026-08-11: conversation shell restored

The later UX-7.4 experiment that moved the chronicle into a separate overlay
and left only a latest-response card on the Game Screen is superseded. The
accepted UX-7 decision is restored: the main surface is a DTO-only conversation
feed with session-scoped player messages followed by Master replies.

Clarifications from the AI-DM Interpretation Gateway are rendered as a
transient Master reply after the player's intent. They never advance world
time, append Events or mutate Projection. Map, character and knowledge remain
the only player spaces in the top navigation; discoveries are rendered inside
the observer-scoped Knowledge surface. Developer diagnostics are not part of
the player shell and must be opened through a separate trusted-LAN surface.
