# ADR 0008: Belief Model freshness and schema v2

Status: accepted

## Context

The observer-facing Belief Model retains evidence while confidence and freshness
decay with simulation time. PatternBelief.freshness is a public field needed by
the normal renderer, but adding a required field changes the JSON contract. The
previous v1 contract also allowed decay to multiply an already-decayed
confidence when a read model was refreshed more than once.

## Alternatives

1. Keep schema v1 and make freshness optional. This hides the contract change
   and makes clients guess whether the value exists.
2. Store each decay result as new evidence. This pollutes evidence semantics and
   makes a read operation stateful.
3. Publish schema v2 and recompute confidence from retained evidence on every
   decay call. This makes the change explicit and keeps decay pure and
   idempotent.

## Decision

Accept option 3. BeliefModel and BeliefModelDTO use schemaVersion: 2.
PatternBelief.freshness is required. Decay derives a stable base confidence
from supportingEvidence, then applies the deterministic freshness factor.
Calling decay repeatedly with the same state evidence, now and window produces
the same confidence; evidence is never deleted or rewritten.

This is a read-side contract change only. It adds no Domain Events, Rules,
persistence tables or renderer authority.

## Consequences and gates

- Contract docs, zod validation, TypeScript types and JSON Schema must all state
  v2.
- Tests cover exact DTO validation, repeated same-time decay and later-time
  decay.
- Clients must reject or explicitly migrate v1 DTOs before rendering v2.
