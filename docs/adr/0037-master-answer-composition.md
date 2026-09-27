# ADR-0037: Master answer composition — allowed fact selection

## Context

`narrateAnswerLLM` currently receives one finished deterministic answer and is
told to keep its meaning, composition and volume. The model therefore cannot use
a fact the system already knows (the arrival reason, the link to the previous
replica) unless the deterministic builder happened to include it. The result is
a master that can only paraphrase, not answer from material the backend has
already cleared for the player.

The absolute rule «LLM may not select facts» was written for intent and
presentation authority. It is too broad for read-side answer composition.

## Decision

The master may select, group and order elements from the backend-provided
`AllowedNarrativeFacts` set to answer the current replica. It cannot add
elements, change their availability, provenance or epistemic class, or turn a
hypothesis into an established fact.

Mandatory constraints:

1. The backend forms the mandatory result of an action; it must be reflected in
   the answer.
2. The master cannot soften, skip or contradict a refusal, a partial result or a
   consequence.
3. Selecting relevant facts changes neither game importance, visibility, routes,
   available actions nor world state.
4. Testimony, inference and doubt keep their original degree of certainty.
5. The master's temporal references are valid only within the current turn.
6. Internal IDs, the Event Log, Canon, provenance and hidden facts are never put
   in the prompt.
7. The Narrative Adapter stays a pure read-side layer and creates no Domain
   Events.
8. When the LLM is unavailable or its answer is rejected, the deterministic
   answer stays complete and playable.

Two distinct meanings of «importance»: **game importance** (primary/notable/
background, consequences, critical changes) is decided by the backend;
**relevance to the question** (which allowed facts are worth telling now) is the
master's.

`AllowedNarrativeFacts` is the closed contract passed to the model: a bounded
set of typed allowed facts with turn-local references, each carrying content,
provenance, the allowed assertion mode, temporal membership and availability.
It is not an arbitrary read-side context; no other structure is handed to the
model.

## Consequences

- Answer composition is a separate step after intent interpretation: intent
  (`TurnProposalV2`) never reports an action result; composition happens after a
  read-only inquiry or an executed action.
- The existing MasterTurn lifecycle is reused: the deterministic answer shows
  immediately; the verified prose replaces the same bubble; the deterministic
  version is kept on refusal or rejection; reload and replay return the saved
  answer.
- Semantic grounding is not guaranteed by a JSON schema; it is checked by
  structural validation, negative tests and a live corpus. A verifier model is
  not authority.
- Amendments: ADR-0028 (intent vs composition), ADR-0004 and ADR-0013 (the LLM
  may select and order among allowed facts), plus `AGENTS.md`,
  `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` and `docs/PROJECT_MAP.md`.

## Amendment 2026-09-27 — mandatory split and selection by question

The runtime experience (story `master-answer-composition` T4) showed that
passing the whole deterministic answer as one mandatory fact makes a badly
chosen inquiry paragraph an untouchable part of the new prose, and that
group-then-append fact collection can drop a needed description when the
fact limit fills. The decision above is refined as follows:

1. **Mandatory split.** Mandatory content has three distinct sources:
   world results (refusal, partial success, consequence) — always
   mandatory; question parts — mandatory per the semantic question plan
   (`QuestionPart`, ADR-0028 amendment 2026-09-27); deterministic text —
   a full fallback formulation built FROM the same allowed facts, not an
   extra mandatory fact. A paragraph an old inquiry happened to select is
   never mandatory by itself.
2. **Selection by question.** Allowed facts are assembled per question
   part: mandatory results and facts covering every part first, then
   useful context. Space inside the total fact limit is reserved for
   coverage; overflow produces an explicit incomplete-coverage signal
   instead of silently dropping a part.
3. **Provenance, time and availability are independent.** Availability
   (`usableNow`: speakable as a memory now) never rewrites temporal
   membership (when the described event happened), and an inquiry text is
   not an `observation` unless its provenance actually is one — it may
   carry told/inferred/doubt from its source.
4. **Semantic checks beyond word overlap.** `fact_mismatch` word overlap
   stays an additional filter only: lexical near-matches («проход открыт»
   vs «проход не открыт») do not prove meaning. Mandatory results are
   checked by citation with stricter negative tests; coverage of every
   understandable question part, preservation of negation, uncertainty
   and temporal meaning, and absence of new subjects, reactions or action
   results are composition requirements.
