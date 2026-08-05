# Architecture Review №1 — `river-hydrology.yaml`

**Review date:** 2026-08-05  
**Scope:** `docs/simulation/definitions/river-hydrology.yaml` reviewed as a *foreign* PR against `docs/SIMULATION_BIBLE_ARCHITECTURE.md`.  
**Goal:** check the Simulation Bible Architecture template on real material, not to validate the River Hydrology implementation itself.  
**Sources inspected:**
- `docs/SIMULATION_BIBLE_ARCHITECTURE.md`
- `docs/adr/0017-river-hydrology-and-crossing.md`
- `docs/simulation/definitions/river-hydrology.yaml`
- `packages/world/src/rules/river-level.ts`
- `packages/world/src/rules/crossing-condition.ts`
- `packages/world/src/region/types.ts`
- `packages/world/src/region/spatial-projector.ts`
- `packages/world/src/region/compiler.ts`
- `packages/world/src/journey/route-resolver.ts`
- `packages/world/src/index.ts`
- `packages/world/test/hydrology/*.test.ts`
- `packages/world/test/journey/route-resolver.test.ts` (by reference)

**Method:** for every field/section of the YAML we asked: (a) which architecture clause requires it, (b) who is the declared consumer, (c) can that consumer be found in code/tools/docs, (d) is the field filled with data or with meta/prose.

---

## Executive summary

The YAML is internally consistent and demonstrates that an author *can* map ADR-0017 onto the proposed Simulation Bible template. However, the template is not yet **exercisable**:

- ~40 % of the YAML text is prose justification, meta-references, or free-text lists rather than machine-readable data.
- Several fields required by the architecture (`implementationEvidence`, distinct `System Binding` artifact) are either missing or replaced by invented keys (`evidence`, `bindings`, `codeTraces`, `simulationDepthCompatibility`).
- The **Consumer Rule** is mostly fiction: declared consumers (`rule-review`, `replay-test`, `Compiler`, `Scheduler`, observation channels) either do not exist as named entities or are not wired to the YAML.
- **V-violations** can be identified by manual code review, but none of them are caught by an automated gate because the `Schema`, `Lint` and `Trace` stages of the architecture do not yet exist.

Conclusion: the architecture is coherent as a *constitution*, but the first Definition exposes that the constitution is still **unenforceable**. Before scaling to a second Definition, the template must be tightened and at least one automated consumer (schema linter or trace checker) must exist.

---

## 1. Fields that nobody used

These fields/sections are present in the YAML, but no tool or code path in the repository reads them.

| Field / Section | Where declared in architecture | Why it is unused |
|---|---|---|
| `publicContract.observableSurface.observationChannels` | §9, §10 (Observation Integration) | Channel names `direct-observation`, `attempted-travel`, `proximity` are invented. The Observation Engine and Belief builder do not consume a channel registry from SB. `grep` over `packages/` returns no matches. |
| `publicContract.observableSurface.discoveryCandidates` | §12.1 (Engineering Impact rule of inference) | Discovery is currently built from Events/Presentation in `packages/world/src/discovery/`. No compiler or linter reads `discoveryCandidates`. The entries are prose, not structured data. |
| `publicContract.observableSurface.hiddenAspects: []` | §10 (Observation Integration) | Empty marker. Because there is no observation-channel schema, this empty list is unverifiable. |
| `publicContract.guarantees[*].consumer` | §4.6 | Values `[replay-test, rule-review]` are free-text labels. There is no consumer registry, no test↔guarantee mapping, and no linter checking that every guarantee has a test. |
| `operationalProfile.budget.notes` | §13 (Simulation Budget) | The note justifies why `Aggregated` is not supported. The only reader is a human reviewer. |
| `privateDesign.rationale` | §4.4 (Private Design) | Rationale is useful for review, but it is not a data field with a declared consumer. |
| `bindings` (inside the Definition) | §4.3 says **System Binding is a separate artifact**, not part of Definition | There is no Binding consumer; the example binding is hand-written inside the Definition file. |
| `codeTraces` | Not defined in `System Definition` structure (§4.4) | Invented field. No trace-stage linter exists. |
| `simulationDepthCompatibility` | Not defined in `System Definition` structure | Invented field. No cross-document linter checks Canon↔SB depth compatibility (V-10). |
| `identity.reviewAfter` | §3.4 (Lifecycle) | Free-text meta-reference. No reminder/scheduler consumer. |
| `identity.version` | §4.4 Identity in Public Contract | No tooling consumes the version string. |

**Key signal:** the YAML author had to invent several keys because the architecture does not specify where Binding, trace evidence, and Canon-depth compatibility should live.

---

## 2. Fields that could not be filled without artificial formulations

These fields look populated, but their content is hand-wavy because the architecture gives no concrete schema or source of truth.

| Field | Artificial content | Why it is artificial |
|---|---|---|
| `ownedAspects[*].domain` | `"{ level: ℝ, band: RiverBand }"` | String pseudo-notation. No type grammar, no lint, no link to `packages/world/src/region/types.ts`. The same information already exists in TypeScript. |
| `parameterSlots[*].range` | `"[minimumLevel, maximumLevel]"`, `"ℝ > minimumLevel"` | Informal math. No parser, no bound checking, no link to actual parameter values in `compiler.ts`. |
| `influences[*].dependencyEvidence` | Two prose sentences about route resolver | The only way to express evidence is free text. There is no rubric for "sufficient evidence" and no linter that compares the text to `route-resolver.ts`. |
| `observationChannels` | `direct-observation`, `attempted-travel`, `proximity` | Names are invented; architecture does not enumerate valid channels. |
| `discoveryCandidates` | Two high-level law descriptions | No schema for a candidate; no consumer. Author wrote what sounds reasonable. |
| `guarantees[*].consumer` | `[replay-test, rule-review]` | No registry of guarantee consumers. Labels chosen ad hoc. |
| `budget.notes` | Explanation why `Aggregated` is omitted | Filled only because the field exists and the author felt obliged to justify emptiness. |
| `bindings[0].parameterValues` | `"Материализованы в bootstrap-событии ... здесь не дублируются"` | A note instead of values, because there is no Binding format and values are hardcoded in `compiler.ts`. |
| `reviewAfter` | `"Architecture Review шаблона (Roadmap §15, шаг 3)"` | A meta-sentence instead of a date or trigger condition. |

**Key signal:** whenever the architecture demands a *structured* artifact that does not yet exist, the author falls back to prose. This is honest but shows the template is not yet producible.

---

## 3. Information that had to be repeated

| Information | Where it lives | Where it is repeated in the YAML |
|---|---|---|
| River process parameters | `ADR-0017 §1`, `RiverProcessDefinition` in `region/types.ts`, hardcoded in `region/compiler.ts` | `parameterSlots` (definition of slots, not values) |
| Crossing thresholds | `ADR-0017 §4`, `CrossingDefinition` in `region/types.ts`, hardcoded in `compiler.ts` | `privateDesign.stateSemantics.crossingThresholds` and guarantee `crossing-condition-derived` |
| Event list (`RiverProcessDefined`, `RiverLevelChanged`, `CrossingConditionInitialized`, `CrossingConditionChanged`) | `ADR-0017 §3–5`, `event-types.ts`, rule `produces` arrays | `publicContract.observableSurface.emits` and `consumes` |
| Deterministic cyclic profile | `computeRiverLevel` implementation | `operationalProfile.discretization` |
| Route resolver behavior | `journey/route-resolver.ts` | `influences[spatial-movement].dependencyEvidence` |
| Source file locations | `packages/world/src/rules/river-level.ts`, etc. | `identity.provenance.sources`, `codeTraces.rules`, `guarantees[*].evidence` |
| Simulation depth compatibility | ADR-0017 decision (TickDriven process supports Simulated facts) | `simulationDepthCompatibility` (invented field) |

**Key signal:** the YAML is a *re-statement* of ADR-0017 and code. This is expected for a retro-import (Canon A−25 pattern), but the architecture does not yet define how to avoid drift between the SB Definition, the TypeScript types, and the bootstrap compiler.

---

## 4. Where the Consumer Rule turned out to be fiction

The architecture states: *"Каждое поле описания системы обязано иметь явного потребителя (Compiler / линтер / ревью / тест). Поле без потребителя — кандидат на удаление."* (§2 Consumer Rule).

| Declared consumer | Does it exist as a named entity? | Verdict |
|---|---|---|
| `Compiler` ( Operational Profile ) | No SB compiler exists. The bootstrap compiler (`region/compiler.ts`) is hand-written and knows nothing about `docs/simulation/`. | Fiction |
| `Scheduler` ( Operational Profile ) | No scheduler outside RuleEngine phases. `TickDriven` is implemented by the rule listening to `TickPassed`. | Fiction |
| `rule-review` ( guarantee consumer ) | No review checklist or tool maps guarantee IDs to review steps. | Fiction |
| `replay-test` ( guarantee consumer ) | Tests exist, but no guarantee↔test mapping. The author *claims* replay tests cover the guarantee; no registry verifies it. | Partially fiction |
| `observationChannels` consumers | Observation Engine does not read them. | Fiction |
| `discoveryCandidates` consumers | Discovery builder does not read them. | Fiction |
| `codeTraces` consumers | No trace-stage linter. | Fiction |
| `reviewAfter` consumer | No reminder/scheduler. | Fiction |

**Honest consumers found:** the only real consumers are the human reviewer and the runtime RuleEngine (via `listens`/`produces` in the rule code itself). But the RuleEngine does not read the YAML; it reads the rule objects exported from `@skald/world`.

**Key signal:** without a linter or compiler, the Consumer Rule can only be checked by assertion. The YAML author asserts consumers that do not exist.

---

## 5. Ambiguities discovered

| Topic | Ambiguity | Risk |
|---|---|---|
| **Placement of System Binding** | Architecture §4.3 says Binding is separate from Definition, yet the YAML includes a `bindings` section. Is a Definition allowed to contain an illustrative Binding, or must Binding live in `docs/simulation/bindings/`? | Risk of mixing contract (Definition) with instance (Binding). |
| **`guarantees[*].evidence` vs `implementationEvidence`** | Architecture §4.6 requires `implementationEvidence`. The YAML uses `evidence` with sub-items `Rule: ...`. The schema stage will have to choose one. | Schema mismatch between template and first data file. |
| **What is a valid `observationChannel`?** | Architecture §9 says channels exist, but provides no enum or registry. | Authors will invent inconsistent channel names. |
| **What is a valid `consumer` value?** | No enum/registry. | Guarantees become unlintable. |
| **`budget.supports` vs `budget.notes`** | YAML declares `supports: [Full]` and explains in `notes` that `Aggregated` is omitted. Architecture §13 says `BootstrapOnly` is reachable trivially. Is the omission of `Aggregated` a property of the Definition or of this Binding? | Blurs Definition↔Binding boundary. |
| **`ownedAspects[*].domain` notation** | Pseudo-TypeScript string. No grammar. | Cannot be linted or used by a compiler. |
| **`parameterSlots[*].range` notation** | Informal math with references to other slot names. | Cannot be evaluated mechanically. |
| **Boundary between Public Contract and Private Design** | `privateDesign.stateSemantics` describes `riverBand` and `crossingThresholds`, but these are observable/used by Presentation. Are they truly private? | Potential Private Leakage (V-04) or mis-categorization. |
| **`CrossingConditionInitialized` event carries thresholds** | The YAML says thresholds belong to Binding, but the bootstrap event hardcodes them in `compiler.ts`. Where is the real Binding? | Ambiguity: thresholds are part of Definition (slot shape) or Binding (values)? |
| **`simulationDepthCompatibility`** | Not an architecture field. The author added it to express V-10 compliance, but there is no agreed place for it. | Unregulated extension of the template. |

---

## 6. V-violations: what can actually be checked vs. what exists only on paper

| ID | Violation | Check performed | Evidence | Verdict |
|---|---|---|---|---|
| V-01 Second Truth Source | SB/Canon duplicate each other’s area | Checked overlap between YAML and Canon Model (`docs/canon/`). River hydrology is not yet in Canon, so no overlap today. The YAML retro-imports from code, not from Canon. | `docs/canon/` has no hydrology concept. | **Not found in this file**, but the V is unlinted. |
| V-02 Hidden Configuration | Influence on world bypassing Event Log | Reviewed `spatial-projector.ts`. It updates `crossingStates` directly inside the `RiverLevelChanged` handler (lines 90-92) **and** listens to `CrossingConditionChanged`. The crossing state is derivable from `RiverLevelChanged` alone; duplicating the update in the projector is not a hidden config, but it is a **dual source of the same derived state** within Projection. | `spatial-projector.ts` lines 82-92 and 108-116. | **Code smell**, not a strict V-02; no linter catches it. |
| V-03 Direct System Reference | Systems reference each other not through Events | Rules read `world.spatial.*` maps. That is Projection, not direct system reference. Route resolver reads `crossingStates` from Projection. | `route-resolver.ts`, `river-level.ts`, `crossing-condition.ts`. | **Not found**. On-paper only. |
| V-04 Private Leakage | External consumers depend on Private Design | `packages/world/src/index.ts` exports `computeRiverLevel`, `classifyRiverBand`, `classifyCrossingCondition`, `computeCrossingTravelTicks` — pure internal helper functions. Tests and any external package can import them. | `packages/world/src/index.ts` lines 164-165. | **Real, verifiable today.** |
| V-05 Hollow Guarantee | Guarantee without test or implementation evidence | `river-event-emission-honest` and `observer-knowledge-lag` have no dedicated tests. `observer-knowledge-lag` is only covered by the general observation boundary, not by a named test. | `packages/world/test/hydrology/*.test.ts`, no test for "only emit on change" or offline knowledge lag. | **Partially real** — can be found by manual test audit; no gate enforces it. |
| V-06 NonDeterministic Synthesis | unfold/seed outside Event Log; cache affects events | `computeRiverLevel` is deterministic from Event Log + definition. No randomness. | Code review. | **Not found**. |
| V-07 Stored Derived Knowledge | Projection stores derived knowledge beyond Event Log | Projection stores `riverStates` and `crossingStates`, but these are derivable from `RiverProcessDefined` + `CrossingConditionInitialized` + `TickPassed`. This is legitimate Projection Purity, not V-07. | `spatial-projector.ts`. | **Not a violation**, but the boundary is paper-only without a replay-purity test specifically for spatial projection. |
| V-08 Phantom Dependency | `dependsOn`/`influences` edge without dependency evidence | `influences → spatial-movement` has prose evidence. No linter verifies that the route resolver actually consumes `crossingStates` or that the events listed are the real events. | `route-resolver.ts` does consume `crossingStates`, but the link is not machine-checked. | **On paper only**; manual review confirms the edge is real. |
| V-09 Layer Hierarchy | Describing systems as tree/layers | YAML avoids the word "layer". | Review. | **Not found**. |
| V-10 Depth/Update Mismatch | Canon `SimulationDepth` incompatible with SB `UpdateModel` | YAML adds `simulationDepthCompatibility: [NarrativeOnly, Observable, Simulated]`. This is an invented assertion; no Canon fact currently references `river-hydrology`, so no mismatch to check. | `docs/canon/` has no hydrology concept. | **On paper only**. |

**Summary of enforceability:**

- **Verifiable today by manual review:** V-04 (private leakage via exports), V-05 (missing guarantee tests).
- **Verifiable in principle but without a gate:** V-02 (dual derived-state update in projector), V-08 (edge evidence exists but is not machine-checked).
- **Existing only on paper:** V-01, V-03, V-06, V-07, V-09, V-10 — these will remain decorative until the Schema, Lint and Trace stages are built.

---

## 7. Template defects exposed by this review

1. **No schema means no Consumer Rule enforcement.** Every free-text field (`domain`, `range`, `consumer`, `dependencyEvidence`, `observationChannels`) is a place where the author must invent content.
2. **Binding is not separated.** The architecture says Definition and Binding are different artifacts, but the first author put Binding inside the Definition because there is no `docs/simulation/bindings/` convention.
3. **`implementationEvidence` vs `evidence`.** The architecture uses one key, the YAML uses another. The schema stage must decide.
4. **No cross-link to code.** `codeTraces` is hand-written. A Trace-stage linter should derive rule/event/type traces from imports and rule registry.
5. **No cross-link to Canon.** V-10 and `simulationDepthCompatibility` are asserted, not checked.
6. **Public/Private boundary is vague.** Internal helper functions were exported because the project has no "internal" visibility policy. SB cannot fix TypeScript exports, but it must at least flag Private Leakage in review.

---

## 8. Recommendations before the second Definition

1. **Freeze a minimal YAML schema** (zod or JSON Schema) for `System Definition` with:
   - closed set of top-level keys;
   - enumerated `consumer` values or require each consumer to be a URL/path to a real test/linter;
   - `implementationEvidence` (not `evidence`) with a required `kind: Rule | Test | Lint | Review` and a machine-resolvable reference.
2. **Move `bindings/` out of `definitions/`** and provide a `System Binding` template. Until then, forbid `bindings` inside Definition.
3. **Remove or formalize invented fields:** `codeTraces`, `simulationDepthCompatibility` should become part of the Trace stage or be deleted.
4. **Add one automated consumer:** at minimum a script that checks every `Rule:` reference in `implementationEvidence` against `packages/world/src/rules/*.ts` and every `event:` against `event-types.ts`.
5. **Define a rubric for `dependencyEvidence`:** require an event name or an owned-aspect path, not prose.
6. **Fix V-04 in code:** stop exporting `computeRiverLevel`, `classifyRiverBand`, `classifyCrossingCondition`, `computeCrossingTravelTicks` from `@skald/world` public index; export only the `Rule` objects and types.
7. **Add guarantee tests:** at least one test per guarantee ID, and a mapping file or convention (e.g., test file name contains guarantee id).

---

## 9. Conclusion

`river-hydrology.yaml` is a readable retro-import of an existing, well-tested system. As a **System Definition**, however, it is more of a structured narrative than a contract: many fields are prose, consumers are asserted rather than wired, and the boundary between Definition, Binding and Private Design is blurred.

The architecture itself survived the review: the concepts (Public Contract, Operational Profile, Private Design, Update Model, Guarantees, V-registry) are useful and map cleanly onto the code. The main gap is **enforceability**. Until at least a schema linter and a trace checker exist, the Simulation Bible Architecture will describe an ideal world, while the YAML files will continue to be judged by human interpretation alone.

**Verdict for `river-hydrology.yaml`:** *approve as the first experimental Definition, with the explicit condition that the defects above are fixed before the file is promoted from Experimental to Candidate.*
