# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-07-29
Branch: main
Working tree: UX-5.0B/C implementation complete, awaiting browser QA and commit

## Current milestone

UX-5.0B/C — Production Game Shell vertical slice is implemented from the UX v13 prototype.

41 test files, 542 tests + 1 skip, tsc clean, npm run validate PASS.

## Completed

UX-0: Product contract, authority boundaries, screen inventory
UX-1: Playable shell, client-state, reconnect, keyboard, accessibility
UX-2: Discovery read model, presentation marks, builder, discovery-view.js
UX-3: Guidance phases, selector, allowlist, onboarding UI, dismissal
UX-4.0: Multi-world persistence, schema v2, WorldRuntimeManager, scoped API,
        Main Menu, Continue, hash routing, world-api-client
UX-4.1: Character presets, world templates, schema v3, POST /api/worlds,
        atomic creation with idempotency, New Game flow UI
UX-5.0A: Game Shell read model, character/world/situation/attention views,
         causal turn chain, world activity, knowledge summary, scoped HTTP API,
         shellDelta for command/wait paths, replay and persistence regressions
UX-5.0B/C: Production shell layout from UX v13, desktop/mobile responsive CSS,
          causal timeline, world activity strip, context tabs, command dock,
          journal/discovery/dev overlays, loading/error states, selected-world
          read-model routing, crypto.randomUUID fallback and New Game rerender fix

## Next

Run the fixed `$skald-ntfs-browser-qa` task against the deployed Orange Pi build.
Verify menu → Continue → game shell, one authorized movement/social command,
causal timeline, Journal/Discoveries/Dev overlays, reload persistence and mobile
layout. Then commit and push, followed by Orange Pi update and post-deploy smoke.

## Known blockers

None in repository validation. Visual QA is still pending.