# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-07-30
Branch: main
Working tree: Iteration 15 complete, committed and deployed to Orange Pi

## Current milestone

Iteration 15 — Open Intent and Critical Checks is complete and deployed.

44 test files, 687 tests passed + 1 skipped, tsc clean, npm run validate PASS.

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

Deployment verified on Orange Pi commit 55dc995: service, timers, health/state and 10-turn API smoke passed.
API smoke added turns 94-103; an additional duplicate-key probe correctly returned HTTP 409 and advanced state once to 104.
Visual NTFS browser QA remains a separate optional gate.

## Known blockers

None for repository, deployment or API smoke. Visual QA is not claimed in this handoff.
