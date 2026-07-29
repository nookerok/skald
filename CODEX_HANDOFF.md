# Codex Handoff

Mutable milestone note. Git, tests and current source outrank this file.

Updated: 2026-07-29
Branch: main
Working tree: UX-4.1 implementation in progress

## Current milestone

UX-4.1 — New Game Flow & Real Save Creation.

Backend goals:
- Character presets and world templates (static server allowlists)
- POST /api/worlds with atomic create transaction + idempotency
- Schema v3 (world_creation_requests table)
- Catalog endpoints: /api/character-presets, /api/world-templates

UI goals:
- Character Selection screen with name input and preset cards
- World Selection screen with template cards
- Confirmation screen with creation pending/retry
- Hash routing: #/new/character, #/new/world, #/new/confirm
- Draft and pending-request persistence in sessionStorage

## Completed

UX-0: Product contract, authority boundaries, screen inventory
UX-1: Playable shell, client-state, reconnect, keyboard, accessibility
UX-2: Discovery read model, presentation marks, builder, discovery-view.js
UX-3: Guidance phases, selector, allowlist, onboarding UI, dismissal
UX-4.0: Multi-world persistence (schema v2), WorldRuntimeManager, scoped
        HTTP API, Main Menu, Continue, hash routing, world-api-client

## Current task

Build UX-4.1: character presets, world templates, schema v3, POST /api/worlds,
catalog endpoints, New Game flow UI.

## Known blockers

None. All gates pass.

## Do not continue

- Do not add Domain Events or Rules for world creation or character selection.
- Do not add gameplay bonuses to character presets.
- Do not add deletion/renaming/archiving (deferred to UX-4.2).
- Do not add LLM-generated characters or worlds.
