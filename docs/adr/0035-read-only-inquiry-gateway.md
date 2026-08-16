# ADR-0035: Read-only Inquiry Gateway

Status: accepted

## Context

The player command field accepts both world-changing intentions and questions
to the Game Master. A direct question such as «где я?» must not be parsed as an
in-world speech action merely because it has no deterministic action verb.

## Decision

Player input is classified into three presentation classes:

```text
Inquiry       → registered read-only query over Game Shell DTO
Action        → existing Intent/Command/Rule pipeline
In-world speech → existing communicate/speak action pipeline
```

Inquiry answers are built by a pure read-side registry in `world/` from the
observer-scoped Game Shell and approved background context. They do not append
Events, advance time, create observations, reveal map geometry or schedule
narration.

Deterministic patterns handle the initial query vocabulary. A free-form
question may use `InquiryProposalV1`, but the model can only select a registered
query id. It cannot provide facts, identifiers, coordinates, Events or
consequences. The deterministic builder remains authoritative for the answer.

The existing command endpoint returns `status: "inquiry"` for this read path.
The browser renders a session-only `ТЫ → МАСТЕР` exchange; it is not a journal
turn and is not persisted as a Domain Event.

## Invariants

- Event Log, Projection and world time are unchanged by Inquiry.
- Unknown routes, objects, contacts and coordinates do not cross the observer boundary.
- A question addressed to an NPC remains in-world speech.
- LLM failures produce a natural clarification, never a technical parser message.

## Consequences

The normal game surface supports a seamless conversation without weakening the
authoritative simulation contract. The query registry must be extended when a
new player-facing question is accepted; arbitrary LLM answers are not allowed.
