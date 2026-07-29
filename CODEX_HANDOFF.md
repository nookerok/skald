# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-07-29
Branch: main
Working tree: UX-5.0A complete, awaiting commit and push

## Current milestone

UX-5.0A — Game Shell backend read model is complete.

41 test files, 541 tests + 1 skip, tsc clean.

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

## Next

UX-5.0B — Production Game Shell UI. Keep classification and authority on the
backend; route real browser, responsive and accessibility QA through
`$skald-ntfs-browser-qa`.

## Known blockers

None. All repository gates pass.