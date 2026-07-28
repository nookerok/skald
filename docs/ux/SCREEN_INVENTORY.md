# UX Screen Inventory

## Tier A — UX-1 production screens

1. Game Screen
2. Turn Presentation
3. Journal
4. Thread-filtered Journal
5. Loading/recovery state
6. Reconnect/error state
7. Developer Diagnostics

These screens are backed by the current API and may be implemented without
new domain Events or Rules.

## Tier B — planned screens

1. Discovery/Trace
2. Hypothesis
3. Discovery detail
4. Character identity summary
5. Onboarding transition

These depend on the Discovery and Onboarding milestones.

## Tier C — future concepts

Main Menu, Character Selection, World Selection, Character Creation,
Inventory, Map, NPC Dialogue Focus, Account/Save Management and Offline Mode.

## Screen record

Every screen in future UX work must document:

- purpose and player question;
- authoritative data source;
- supported actions and command mapping;
- parent and exit route;
- desktop/tablet/mobile layout;
- loading, pending, empty, stale, reconnect and error behavior;
- accessibility roles and announcements;
- missing backend dependencies.

There is no requirement to create 15 x 3 x 7 independent production frames.
Shared state and responsive component rules are preferred.
