# ADR 0028: AI-DM intent proposal gateway

Status: accepted

## Context

The deterministic intent parser handles the registered grammar well, but a
player can express one intention in richer free text than a finite verb list
can reliably normalize. The game needs an AI-DM interpretation layer without
allowing an LLM to become a hidden source of world truth.

## Decision

Player text enters an Interpretation Gateway. Deterministic parsing is the
fast path for an unambiguous registered command. Unknown, low-confidence or
compound text may be sent to an LLM which returns one closed `IntentProposalV1`
JSON object. The proposal is untrusted until the pure schema validator maps it
to an existing transient `ActionIntentCommand`, `InteractionCommand` or
`JourneyIntent`.

The LLM receives only the player text and a static capability manifest. It does
not receive Projection, Event Log, hidden Canon, internal identifiers or
observer truth. It cannot create Domain Events, choose success, resolve a
world target, select a route, set difficulty or describe consequences.

One primary intent is allowed. Additional executable clauses are preserved and
produce a player clarification; they are never silently discarded and never
auto-executed as a chain. A clarification changes neither Event Log nor world
time. After a validated command reaches the existing Command Handler, Rules
read the current `ReadonlyWorld` and remain authoritative for target and route
validation and all consequences.

Interpretation runs before the serialized world command queue. If the provider
times out, returns invalid JSON or is unavailable, no command is committed and
the player is asked to rephrase. Existing deterministic commands continue to
work without a network call.

## Consequences

- No new Domain Event or persistence table is introduced by this slice.
- `parseIntent` remains pure and synchronous; the network adapter lives in the
  CLI runtime gateway.
- Runtime HTTP uses the gateway, while deterministic eval and REPL paths may
  continue to use the existing parser directly.
- LLM interpretation is a fallback feature and can be disabled with
  `SKALD_INTENT_LLM_MODE=off`.
- Real model calls are not part of the mandatory repository validation gate;
  fixture providers cover schema, authority and failure tests.
- Multi-step travel plans are explicitly deferred to a separate ADR because
  they would introduce new execution and cancellation semantics.

## Definition of done

Invalid or authoritative model output cannot reach the Command Handler;
clarifications produce no Events or ticks; a validated proposal maps
deterministically to an existing command; current Rules validate the world;
timeouts and duplicate requests are safe; focused tests and `npm run validate`
pass; and browser QA confirms the clarification is presented as a player-facing
DM response rather than a technical parser error.
