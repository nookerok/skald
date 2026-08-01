# UX Roadmap

## UX-0 — Product Contract (completed)

Capability classification, authority boundaries, screen tiers, interaction
grammar, shared state model and acceptance gates. Documentation only.

## UX-1 — Current Playable Shell (completed)

Responsive Game Screen, presentation, journal, threads, recovery states,
diagnostics, design tokens, accessibility, keyboard navigation.

## UX-2 — Discovery Presentation (completed)

Trace, Hypothesis and Discovery as read-side concepts. Discovery builder,
presentation marks, /api/discoveries, Discovery tab in UI.

## UX-3 — Onboarding & Contextual Suggestions (completed)

Deterministic guidance phases: first_action → explore_world → test_trace →
strengthen_hypothesis → observe_consequence → review_discovery → free_play.
Static action allowlist. Browser guidance-view.js with dismissal.

## UX-4.0 — Main Menu & Multi-World Persistence (completed)

Schema v2 migration, WorldRuntimeManager, scoped HTTP API, Main Menu,
Continue via /api/continue, hash routing, world-api-client.

## UX-4.1 - New Game Flow & Real Save Creation (completed)

Character presets, world templates, schema v3 (world_creation_requests),
POST /api/worlds with atomic create transaction, Character Selection
and World Selection UI, draft and pending state, retry idempotency.

## UX-5.0 - Visual Shell and Observation & Belief (completed)

Atmospheric shell, free-text composer, responsive context rail and normative
Observation & Belief Knowledge renderer. BeliefModelDTO is derived from Event
Log + ReadonlyWorld and deployed on Orange Pi.

## UX-4.2 — Save Management (next)

Deletion, renaming, archiving, export/import of worlds.

## UX-5 — Extended Interactions

Inventory, map, NPC dialogue and natural-language clarification, each as its
own vertical slice with Events, Rules, Projection and API mapping.

## UX-6 — Offline and resilience

Backend presence reconstruction shipped: known-worlds entry path
(`observer-session`), drift over observer-scoped belief reconstruction,
operational checkpoint written only by explicit acknowledge, offline ticks
not observable. Open item: the browser entry-path UI (reconstruction screen
and focus transition) is not yet wired to the endpoints.
Write-capable offline actions still require an explicit synchronization and
conflict-resolution design.

## UX-7 — Visual, audio and accessibility polish

Animation, sound, assets, reduced-motion, responsive QA and performance gates.
