# ADR-0030: Progressive journeys and partial spatial evidence

- Status: Accepted
- Date: 2026-08-11
- Extends: ADR-0015, ADR-0019, ADR-0029

## Context

A journey cannot be an atomic shortcut from an authored source location to a
destination. If the player stops, disconnects, or the world advances while the
player is away, the observer must not receive destination knowledge or a full
route that was never physically traversed. The production map is server-owned:
the client may render only the observer-scoped DTO.

## Decision

A validated JourneyStarted emits one JourneyStepRequested. The consequence
layer schedules the first deterministic TickPassed; subsequent travel ticks
are external player actions (wait) or explicit runtime ticks. The projector
increments JourneyState.elapsedTicks from each non-offline tick.

An stop/interrupt command is allowed during active travel. It emits
JourneyInterrupted and, when at least one step was completed, one
SpatialObservationRecorded for the relation with knowledge: observed and a
deterministic progressFraction. It never emits a destination observation or
PlayerLocationChanged. Only the final tick emits the full relation and
destination observations plus JourneyCompleted.

Offline ticks advance world time and simulation processes but never progress an
active player journey, complete it, or create observer-scoped travel knowledge.

The map projector uses progressFraction to clip observed route geometry to the
physically traversed prefix. The v3 observer DTO supplies reveal zones and
server-validated detail assets; presentation fallback artwork remains
non-authoritative.

## Invariants

1. No interrupted journey exposes the destination as traversed.
2. No partial journey emits full-route geometry.
3. Journey completion is emitted exactly once on the final deterministic tick.
4. Replay of the Event Log reconstructs elapsed/status and observer knowledge.
5. Rumors and canonical-but-undiscovered locations cannot be used as navigation
   targets.

## Consequences

The UI must display a journey as an ongoing conversation with explicit
milestones, not a single command-cycle teleport. Tests cover rule-level
progression, interruption, projection replay, parser behavior, and living-region
integration. Deployment must verify the production world entrypoint and DTO
separately from the browser's visual fallback.
