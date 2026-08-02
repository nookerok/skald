# ADR 0013: Interaction Model v1 — canonical natural-language interaction pipeline

Status: accepted

## Context

The player must be able to formulate an action in free Russian text and have
the world deterministically determine the intent, the target, the applicable
law and the consequences. No action palette, no guessing, no hidden
decisions. Today the codebase runs **two parallel intent pipelines**:

1. `ActionIntentCommand` (open-intent catalog, Iteration 15) →
   `ActionAttempted` → `duration_check` → `ActionValidated` →
   `interaction.*` rules (`interactionObserve`/`interactionHeat`/
   `interactionForce`/`interactionSoundReaction`/`interactionMovement`).
   Each rule re-implements its own name matching against `WorldObject`.
2. `IntentCommand { verb, object }` (narrow World Interaction Model) →
   `InteractionRequested` → `InteractionTimeValidated` →
   `interaction.resolve_target` → `TargetResolved` →
   `interaction.resolve_law` → `InteractionValidated` →
   `perception.examine` → `EntityExamined`. Currently registers exactly one
   verb (`examine`, law `perception`) and one law rule.

Observable defects of the status quo:

- Russian text never reaches the narrow pipeline: `interpretIntent` always
  yields `ActionIntentCommand`; only the exact-English regex
  `/^examine\s+(.*)$/i` yields `IntentCommand`. The offline queue (ADR-0011)
  therefore accepts only English `examine X`, while its player-facing message
  already promises «осмотреть <объект>» — the Russian claim is aspirational.
- Target resolution is a first-by-id match (`findExamineTarget` shared with
  the offline classifier): no ambiguity detection, no candidate list, no
  scope/visibility beyond distance, no `ambiguous_target` rejection.
- `Entity` (from `ObjectPlaced`) and `WorldObject` (from `WorldObjectPlaced`)
  are two read models built from different events with no alignment — a drift
  risk; there is no inventory, no unified `take`/`open`/`force` chain, and
  critical checks live inside the legacy `interactionForce` rule.
- Every new verb means a new Rule with its own duplicated matching logic.

## Alternatives

1. **Keep both pipelines and widen them in parallel.** Dropped: duplicated
   gates, duplicated matching, and the drift already visible today.
2. **Big-bang replacement of `ActionIntentCommand`.** Dropped: breaks the
   offline queue and the integration suite; violates the gradual-migration
   principle.
3. **Substring-only matching as the final vocabulary mechanism.** Dropped:
   accepted only as the deterministic fallback for v1 Russian normalization;
   the parser must return a canonical verb plus structured target fields.
4. **Let the parser resolve world-dependent ambiguity** ("дверь справа").
   Dropped: the parser has no world access (AGENTS, §12.8 ARCHITECTURE.md);
   ambiguity is classified by a Rule with `ReadonlyWorld`.
5. **Keep `ActionAttempted` as the canonical interaction start.** Dropped:
   `InteractionRequested` is already the narrow canonical start; convergence
   moves onto it.
6. **Introduce a third canonical object model.** Dropped: no third object
   model; `InteractionTarget` is a pure adapter over `ReadonlyWorld`.

## Decision

Introduce the Interaction Model v1: one canonical pipeline, a fixed verb set,
a unified target resolver, and Entity/WorldObject alignment, delivered as
seven sequential vertical slices.

### 1. One canonical pipeline

The canonical transient command is `InteractionCommand` — a plain in-memory
object, **not** a Domain Event, never persisted:

```ts
interface InteractionCommand {
  readonly type: "InteractionCommand";
  readonly verb: InteractionVerb;              // canonical verb, see §2
  readonly target?: IntentReference;           // as the player named it
  readonly secondaryTarget?: IntentReference;  // give: recipient
  readonly instrument?: IntentReference;
  readonly utterance?: string;
  readonly rawText: string;
  readonly interpretation: InterpretationMeta; // source, confidence, ambiguities
}
```

- `InteractionRequested` becomes the canonical start of every world
  interaction; `duration_check` stays its sole owner.
- `ActionAttempted` remains only for the legacy verbs that are not rewritten
  (`move`/`wait`/legacy social). No new verb is ever routed through it.
- The two command forms converge **before** the Command Handler: Russian
  text and the English `examine` alias produce `InteractionCommand` for the
  v1 verb set; `move`/`wait`/legacy social keep producing
  `ActionIntentCommand`.
- `interactionObserve`/`interactionForce` migrate onto the canonical chain
  gradually (Slice 1 and Slice 6); no big-bang.

### 2. Canonical verbs v1

```text
observe | inspect | listen | touch | take | open | apply_force | give
```

`examine` is an alias of `inspect`. The parser normalizes Russian forms
(«осмотреть дверь», «осматриваю дверь», «изучить петли», «прислушаться у
окна», «коснуться жаровни», «потрогать камень», «взять пепел», «поднять
верёвку», «открыть дверь», «попытаться открыть сундук», «толкнуть дверь»,
«навалиться на створку», «отдать пепел торговцу», «передать верёвку
незнакомцу»). A deterministic stem list is the v1 fallback, not the final
mechanism. The parse result carries: canonical verb, raw target name, second
target for `give`, instrument, confidence, syntactic ambiguities. The parser
never checks world existence.

### 3. Unified Target Resolver

```ts
type TargetResolution =
  | { kind: "resolved"; target: InteractionTarget }
  | { kind: "environment"; locationId: string }
  | { kind: "missing" }
  | { kind: "ambiguous"; candidates: readonly PlayerFacingCandidate[] };
```

- Observer/player scope only; exact name beats alias; partial match only when
  it selects a single candidate; two equal matches → `ambiguous`; invisible
  or unavailable targets are excluded; candidates never carry internal IDs.
- `observe`/`listen` may resolve to the environment when no target is named;
  `take`/`open`/`touch`/`apply_force` require a concrete target; `give`
  requires an owned item plus an observable recipient.
- Ambiguity emits `ActionRejected { reason: "ambiguous_target",
  candidateNames: ["Башенная дверь", "Дверные петли"] }` — rejection, not a
  long-lived clarification state.
- **One resolver** is used by the runtime gate, the offline classifier and
  the HTTP/integration tests (continues the ADR-0011 shared-predicate
  principle: runtime and offline can never disagree).

### 4. Entity vs WorldObject alignment

- `WorldObject` stays the mutable physical model; `Entity` stays the
  compatible generic read view.
- `InteractionTarget` is a pure adapter over `ReadonlyWorld`; `WorldObjectPlaced`
  also yields the target components. Both derive from the same Domain Event;
  there is no manual synchronization.
- A mutable action on a generic `Entity` without a physical `WorldObject` is
  `not_applicable`. No third canonical object model.

### 5. Vertical slices (order is mandatory)

Each slice: focused tests → `npm run validate` → review; the next slice
starts only after the previous one is closed.

| # | Slice | Canonical chain | New events |
|---|-------|-----------------|------------|
| 1 | observe + inspect | `InteractionRequested → InteractionTimeValidated → TargetResolved → InteractionValidated(law: perception) → EntityExamined / ObjectObserved → ObservationRecord` | `EntityExamined`, `ObjectObserved` (existing), `ObservationRecord` |
| 2 | listen | auditory law | `SoundObserved`, `ActionHadNoObservableEffect` |
| 3 | touch | tactile law | `EntityTouched`, `ObservationUpdated`, `ConsequenceCreated` (only real danger) |
| 4 | take + inventory | possession law | `ItemTaken`, `ItemDropped` |
| 5 | open | access law | `ObjectOpened`, `ObjectClosed`, `PassageOpened` |
| 6 | apply_force + critical checks | force law, migrated | `CriticalCheckRequested → CriticalCheckRolled → CriticalCheckResolved → ObjectIntegrityChanged / PassageOpened / ConsequenceCreated` |
| 7 | give | transfer law | `ItemTransferred { itemId, fromOwnerId, toOwnerId }` |

Slice invariants: observe without a target describes surroundings only;
inspect requires a concrete target; hidden properties are never revealed;
re-inspection refreshes freshness; open never auto-transitions to
apply_force; a roll happens only after all gates, with one modifier applied
once, model-fixed DC, crash recovery, one owner of `ActionResolved`, no
double damage/noise, replay uses the recorded roll, and failure also has an
understandable consequence. The transfer Rule never assigns
gratitude/fear/trust — downstream Rules may.

### 6. Presentation and UI

Backend `PresentationTemplate`s classify importance (primary/notable/
background); gate events stay hidden. The composer is the only action
control (textarea + «Отправить»). No D-pad, no verb buttons, no action
chips, no autocomplete that replaces the intent. The LLM may paraphrase
only server-chosen facts, never select facts, importance or actions.

### 7. Offline boundary

`inspect`/`examine` may move to the new shared resolver immediately. The
other verbs (`listen`/`touch`/`take`/`open`/`apply_force`/`give`) are
online-only initially; offline expansion is later UX-6.4 work. A critical
roll never happens before successful reconnect/classification; a conflict
is never silently rebased.

## Consequences and gates

- **File structure** (no new top-level packages, no new SQLite tables):
  `packages/world/src/interactions/{types,registry,target-resolver,
  target-view,index}.ts`; `packages/world/src/rules/interactions/
  {perception,listening,touch,possession,access,force,transfer}.ts`; single
  composition root stays `packages/world/src/rules/registry.ts`;
  `rules/world-interaction.ts` is split/migrated. `interaction-registry.ts`
  grows to the v1 verb set.
- **Docs**: `docs/WORLD_INTERACTION_MODEL.md` moves from v0 draft to the
  accepted v1 contract; `docs/ux/INTERACTION_GRAMMAR.md` registers the v1
  intentions; GLOSSARY gains InteractionCommand, InteractionVerb,
  TargetResolution, `ambiguous_target`; DECISIONS gets a new entry;
  UX_ROADMAP slots the milestone between UX-6.3 and UX-6.4; CODEX_HANDOFF
  tracks slice status.
- **Mandatory tests**: one unit test per exported Rule
  (`Given Domain Event + ReadonlyWorld → Rule → exact Domain Events`) plus
  the common gates: parser determinism; resolver determinism;
  exact/alias/partial/ambiguous/missing resolution; runtime and offline use
  the same resolver; immutable DTOs; one intent per command; action budget
  spent once; single owner per gate and per outcome; no Domain Event on
  command-side structural rejection; projection replay equality; SQLite
  restart equality; idempotency; durable dice recovery; no internal IDs in
  player-facing DTOs; LLM prompts without hidden properties; browser
  ES-module syntax; desktop/mobile NTFS QA for UI changes.
- **Definition of Done**: the full word cycle «осмотреться →
  прислушаться → изучить дверь → коснуться петель → взять пепел →
  попытаться открыть дверь → навалиться на неё → пройти внутрь → отдать
  найденный предмет персонажу» runs through the single canonical pipeline
  with facts and consequences, no ambiguity guessing, dice only on real
  risk, the UI never proposes actions, the Event Log remains the sole truth,
  replay/restart are identical, full `npm run validate` passes and real
  browser QA is recorded.
