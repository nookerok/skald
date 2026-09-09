# ADR 0028: AI-DM intent proposal gateway (Master Turn revision)

Status: accepted

Amended 2026-09-06: the Interpretation Gateway becomes the Master Turn
Gateway. It understands one whole player replica in observer-safe
conversation context, not one isolated command. This revision replaces the
previous contract, it does not create a competing architecture.

Amended 2026-09-09 (plan_7 transcript memory): the transcript becomes a
durable read-side memory. `conversation_turns` gains a nullable
`conversation_context_json` column (schema v12) carrying structured
mentions, the stated goal, clarification payloads, continuation links and
the dramatic thread — never prompts, ids, Canon, hidden facts, confidence
or Event fragments. The gateway prompt carries a `master_turn` envelope
with the bounded `ConversationContext`; the model may report its relation
to the pending clarification (`conversationRelation`), which the server
resolves into a durable continuation link. Nothing here becomes World
State: Rules never read the transcript.

## Context

The deterministic intent parser handles the registered grammar well, but a
player can express one intention in richer free text than a finite verb list
can reliably normalize. A single replica may also combine an action with a
read-only question, character speech, a manner constraint or a deferred
second action, and it may use pronouns or references to the previous replica
(`ему`, `ней`, `этим`, `туда`, `за ней`). The game needs an AI-DM
interpretation layer without allowing an LLM to become a hidden source of
world truth.

## Decision

Player text enters the Master Turn Gateway. Deterministic parsing remains
the fast path for a simple, confident, unambiguous registered command.
Unknown, low-confidence, contextual, pronoun-bearing or mixed-clause text
goes to an LLM which returns one closed `TurnProposalV2` JSON object
(`IntentProposalV1` stays temporarily for backward compatibility of tests;
production follows V2). The proposal is untrusted until pure static schema
validation plus server-side contextual referent validation map it to a
transient `ValidatedMasterTurnPlan`.

The LLM receives:

- player text (untrusted game data, never instructions);
- static capability manifest (closed registries of verbs, operations,
  inquiry query ids, meta operations);
- bounded observer-safe scene (visible/observed objects, known people,
  known routes, accessible items with affordances, observed situation,
  `seen/told/inferred/doubt` knowledge, current `worldTime/eventNumber`);
- bounded recent conversation of the current `worldId`: `lastTurns`
  (at most 12 replicas within a char budget, master side preferring the
  shown ready narration paired by `worldTime`+`correlationId`), structured
  `recentlyMentionedEntities` (transient `observerRef` re-matched against
  the current scene on every build), the `activePlayerGoal` stated by the
  player, the deterministic `currentDramaticThread` (pending clarification
  > goal > observed situation > personal hook), and observer-safe knowledge
  split into `knownFacts` (`seen`) vs `knownUncertainties`
  (`told`/`inferred`/`doubt`);
- unresolved clarification, if any, with its persisted options; a foreign
  inquiry never closes it, an explicit continuation link resolves or
  abandons it, and a world-changing outcome closes it by the legacy rule.

The LLM does not receive:

- Event Log;
- full Projection;
- Canon;
- hidden entities, hidden objects, undiscovered routes;
- internal `entityId`/`locationId`/`eventId`/`worldId`/`sourceEventIds`;
- exact unknown coordinates;
- unavailable inventory;
- foreign observations / foreign knowledge / internal confidence /
  numeric relation values.

One replica maps to at most one executable primary intent. The remaining
parts may be constraints, manner, a read-only question, character speech or
deferred actions. They are never silently discarded and never auto-executed
as a chain.

Fixed guarantees:

- The LLM may select a referent only among the supplied observer-safe
  candidates via transient `observerRef` handles; the server re-resolves
  every referent against the current world.
- A question creates no Events, advances no time and creates no
  Observation; it is answered from a post-action observer snapshot when it
  follows a primary action.
- A supporting clause is never executed as a second action; a noticed
  second action becomes `deferred_action` text for the Master response.
- Stale context requires revalidation inside the world queue against the
  current `worldTime/eventNumber`; a disappeared, inaccessible or newly
  ambiguous target blocks execution with no Events and a natural
  clarification. The LLM is never re-invoked inside the queue.
- This stage adds no multi-step executor, no action queue and no
  `CompositeCommand`.
- `ConversationTurn` transcript stays a non-authoritative read-side record;
  player text never enters the Event Log.

After a validated plan reaches the existing Command Handler / Inquiry
builder, Rules read the current `ReadonlyWorld` and remain authoritative
for target and route validation and all consequences.

Interpretation runs before the serialized world command queue. If the
provider times out, returns invalid JSON or is unavailable, no command is
committed: a safe deterministic fallback is used when one exists, otherwise
the player is asked to rephrase. Existing deterministic commands continue
to work without a network call.

## Consequences

- No new Domain Event is introduced by this contract. Read-side memory
  metadata persists via the v11→v12 migration (`conversation_context_json`,
  NULL for legacy rows, fail-closed parse) and never becomes World State.
  Focus draws structured mentions from validated plans first (inquiry focus
  and speech addressees count on par with action targets) and falls back to
  the deterministic re-parse for legacy rows.
- `parseIntent` remains pure and synchronous; the network adapter lives in
  the CLI runtime gateway.
- Runtime HTTP uses the gateway, while deterministic eval and REPL paths may
  continue to use the existing parser directly.
- LLM interpretation is a fallback feature and can be disabled with
  `SKALD_INTENT_LLM_MODE=off`.
- Real model calls are not part of the mandatory repository validation gate;
  fixture providers cover schema, authority and failure tests.
- Multi-step travel plans remain deferred because they would introduce new
  execution and cancellation semantics.

## Definition of done

Invalid or authoritative model output cannot reach the Command Handler;
`unknown` reaches the LLM instead of failing structurally first;
clarifications produce no Events or ticks; a validated proposal maps
deterministically to at most one existing command plus an optional
read-only inquiry; pronouns resolve only through validated focus and
survive reload; stale context never mutates the world; focused tests and
`npm run validate` pass; and browser QA confirms the clarification is
presented as a player-facing DM response rather than a technical parser
error.
