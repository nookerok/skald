# UX Screen Inventory

## Tier A - current production screens

1. Game Screen
2. Observation & Belief Knowledge surface
3. Turn Presentation
4. Journal
5. Thread-filtered Journal
6. Loading/recovery state
7. Reconnect/error state
8. Developer Diagnostics

These screens are backed by the current API and may be implemented without
new domain Events or Rules.

## Tier B - current read-model screens

1. Discovery/Trace
2. Hypothesis
3. Discovery detail
4. Character identity summary
5. Onboarding transition

These are backed by the current Discovery, Guidance and Belief read models.

## Tier C - future concepts

Inventory, NPC Dialogue Focus, Account/Save Management and write-capable
Offline Mode. Main Menu, world selection and character setup are current.

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


## Observation & Belief screen record

Purpose: let the player understand what they currently believe and why.
Authoritative source: observer-scoped BeliefModelDTO and current
ObservationRecord data. Supported actions are read-only expansion/filtering;
in-world actions return to the free-text composer. Empty, stale, unavailable,
contradictory and responsive states are required.
