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

## Implementation amendment: Conversation Director P3 (2026-11-02)

The opt-in `GM_DIRECTOR_LIVE` route interprets free replicas before broad
legacy classification. Exact deterministic actions and persisted clarification
continuations keep their existing paths. `GmTurnDecision` V2 may contain a
closed `TurnProposalV2` payload: its reference slots carry opaque scene handles,
which the server maps to transient observer refs before the SAME static and
contextual validators used by the legacy planner. No new execution authority,
Domain Event, Rule, persistence table or multi-step coordinator is added.
Legacy V1 classification decisions remain readable but cannot carry V2 payloads.

A pure conversation drafts its response during the interpretation call. The
first implementation selects existing fact IDs or closed non-factual social
acts; it does not publish arbitrary unverified prose, NPC knowledge, permission
or commitments. NPC dossier disclosure and voice remain P4/P5, not claimed by
this implementation. The existing `speech/speech_reaction` transcript vocabulary
stores these zero-event, zero-time turns; it does NOT route them through
`communicate` or a durable world commit. Persisted speech times distinguish them
from legacy world-changing speech during crash-window replay.

A per-world live request flight spans inference THROUGH durable replay-envelope
publication. A concurrent identical key shares the completed response; a changed
body conflicts before another inference. This closes the inference-settled /
turn-not-yet-committed window without serializing network calls in the world
queue. Director-level single-flight remains operational state, not a cache or
world state.

Repository tests do not constitute live-model, browser or human acceptance.
The free 20–30-replica session remains an explicit release gate; P3 is not closed
merely because the bridge compiles or scripted models pass.

## Amendment 2026-11-19 — multi-part NPC questions (P3 point 4)

One replica may ask an NPC several questions at once («расскажи про журнал
и кто ещё дежурит?»). The model may now attach a `questionPlan` to a
`conversation` decision: the closed QuestionPlan subjects/parts vocabulary
plus `fragments` — one verbatim replica span per part. Selected
disclosures/explicit gaps bind to parts through `partId`; a social preamble
may precede them.

The server, never the model, owns the truth:

- fragments must be real, ordered, non-overlapping spans of the question
  portion; the addressee of an EXPLICIT address always binds uniquely to
  the named NPC — the model never chooses the speaker, and an absent or
  ambiguous binding falls back to the legacy clarification;
- every question-like clause of the question portion must be FULLY
  contained in exactly one fragment, a fragment grounds at most one such
  clause, and the per-part meaning check runs on the player's CLAUSE, not
  the model's span — a shared word can never cover two questions
  («журнал» cannot ground both «про журнал» and «зачем нужен журнал»);
  tolerated discourse frames must be fragment-grounded the same way, a
  registered world inquiry or an executable action keeps its own path,
  and a lost asked part rejects the whole decision (no partial answer);
- plan subjects carry opaque actor handles (never raw scene refs), are
  contract-checked against the visible-actor allowlist and adapter-bound
  to visible people; a subject may name a third party, never a fabricated
  actor;
- each bound fact must pass the per-part word+aspect check
  (`npcFactAnswersQuestion`): topic stems must overlap AND the aspect must
  fit — a state fact cannot stand in for a reason (почему/зачем without
  causal content), a past-time question, or a who-about-others question
  without a self-reference or a person token in the fact. A failing binding
  degrades that part to the explicit closed gap sentence; the answered
  parts survive («полезная известная часть не пропадает»), and in the
  single-question bridge every RENDERED fact must individually answer —
  one relevant fact can never smuggle a merely-selected one;
- the requested INFORMATION TYPE is binding, from the question itself and
  from the part's DECLARED fields: a fact answering a WHEN-type part must
  itself carry temporal content, a HOW-MUCH part needs a quantity in the
  fact («Когда вы ведёте журнал?» and «Сколько журналов…» can no longer be
  answered by «ведёт журнал проходов у ворот»), a part declared time past
  or aspect known_event is not answerable by the current authored slice,
  purpose explain requires causal or npc_belief content, and a part about
  a THIRD party may only be answered by a fact that actually mentions that
  subject. Verb-bearing question clauses («когда пополняется…») parse as
  unresolved action attempts and are tolerated as single questions when
  they ask for information;
- the reply is composed server-side from authored fact texts and closed gap
  phrases in replica order: zero Domain Events, zero world time, one
  ConversationTurn, idempotent replay unchanged. Worlds created before
  the dossier feature carry no seeded facts and continue through honest
  per-part gaps (an update never retro-seeds old saves).

No new Domain Event, Rule or persistence field is introduced. The
ambiguous-addressee continuation (reload, «я имею в виду X») keeps the
existing persisted clarification machinery; a part-scoped gap is re-askable
as a new replica and is not a persisted continuation slot. Live-model,
browser and human acceptance of the multi-part path remain open gates.


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

## Amendment 2026-09-22 — intent vs answer composition

`TurnProposalV2` interprets the replica only (question, action, speech,
clarification) and never reports an action result. Answer composition is a
separate step: after a read-only inquiry or an executed action, the backend
freezes the allowed fact set (`AllowedNarrativeFacts`) and the mandatory turn
results, and the master selects and orders a subset to answer. See
ADR-0037.

## Amendment 2026-09-27 — fast-path completeness and the semantic question plan

A recognized inquiry may return from the fast path ONLY when it covers the
WHOLE replica, including compound questions and references to the previous
conversation. «Где я?» stays fast; «Где я и почему сюда пришёл?» is not
covered by an early single-query result and goes to the semantic
interpretation path. Incomplete recognition is never silently answered by
one registered `queryId`.

The read-side part of the interpretation contract is extended inside
`TurnProposalV2` (both fields optional and backward compatible):

- `questionPlan`: declared subjects (entity/group/ordinal/topic/place/self;
  groups keep their member links, ordinals keep the identity of the shown
  list plus a 1-based position) and up to four `QuestionPart`s over a
  closed aspect set with an explicit time scope and purpose;
- `readings`: up to three requests per ONE reading round from a closed
  seven-source catalog (`scene`, `person`, `background_arrival`,
  `known_events`, `relations`, `items`, `conversation_topics`).

Limits, closed registries and cross-reference checks are static contract
(normal `TurnProposalV2` validation); contextual subject resolution against
scene, focus stack and conversation memory happens server-side in the
gateway, which builds the validated `QuestionPlan` together with the
validated primary action. A registered inquiry remains a fast read tool; a
free question no longer has to match one `queryId` wholesale.

Unchanged: no new Domain Event, no hidden `observe`/`inspect`/`wait` for a
question, at most one validated primary action per replica (mixed turns
keep the existing limit), and a question after an action is read from the
post-execution snapshot with the existing revalidation. Offline behavior
stays honest: confident registered inquiries and deterministic assembly,
otherwise a clarification — free understanding is never promised without
the model.

Story: `semantic-question-plan` (T1 contract).
