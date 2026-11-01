# Ollama Cloud event-to-prose screen - 2026-11-01

## Scope and verdict

This is a manual, bounded quality screen of six Ollama Cloud candidates on real
Skald event packages. It is separate from route availability/readiness probes,
command-path acceptance, and human playtesting. The result is a preliminary
routing preference, not a statistically reliable model ranking.

The screen used ten distinct sanitized event packages and the same Russian
narration instruction for each model. Each model received one response per
package (60 calls total). No player text, secret, world/entity identifier, or
internal reference was included in the prompt. All packages came from a
scratch-world Event Log; the canonical world was not used.

## Method

For each package, the model was asked to produce one concise, natural Russian
sentence using only the explicit facts in that package. The instruction
prohibited invented causes, actions, weather, motives, and events.

Each response was reviewed on three axes:

- usable response: non-empty and in the expected prose shape;
- factuality: no material claim unsupported by the supplied events;
- Russian readability: understandable, grammatical narration suitable for a
  player-facing line.

This was a manual one-pass review. It is not a blind, multi-rater, or
multi-temperature benchmark. Latencies below are approximate observed p50s for
this run and are not an SLA.

## Event-package coverage

| Package | Event facts represented |
| --- | --- |
| 1 | Approach, one tick, river state |
| 2 | Repeat approach / already-near state, one tick, river state |
| 3 | Journey request, river rise, crossing progress |
| 4 | Action rejected while travelling; no action tick |
| 5 | Journey interrupted after partial progress |
| 6 | Journey resumed, river facts, progress |
| 7 | Journey arrival and location change |
| 8 | Blocked destination / no route |
| 9 | Weather unchanged |
| 10 | Wind change |

The source was a throwaway scratch Event Log. Raw eventNumber ranges in that
disposable log are not persistent Skald identifiers. Event packages were
sanitized to event type and player-relevant payload facts before dispatch.

## Results

| Model | Usable | Factuality | Russian | Approx. p50 | Decision |
| --- | ---: | --- | --- | ---: | --- |
| gemma4:31b-cloud | 10/10 | 10/10: no material invention observed | Readable, concise | 547 ms | Keep as primary |
| gemma4:31b | 10/10 | 10/10: no material invention observed | Readable; one awkward passive construction | 514 ms | Keep as backup |
| nemotron-3-ultra | 10/10 | 10/10: no material invention observed | Readable, sometimes omits detail | 1305 ms | Keep as final Ollama fallback |
| nemotron-3-super | 10/10 non-empty | Fail: one malformed fabricated quote and one strengthened inference | One materially garbled answer | 660 ms | Exclude from default route |
| nemotron-3-nano:30b | 10/10 non-empty | Fail: unsupported content in at least 6/10 packages | Uneven | 794 ms | Exclude from default route |
| beam | 0/10 usable event-to-prose responses | Not rateable | Not rateable | n/a | Exclude from default route |

Representative Nano inventions included a claim that the ferryman raised the
oars as the water rose, an assertion that no crossing existed, an invented
missing map, and invented sunlight. The Super sample included a garbled
fabricated utterance and converted a tentative possibility into a necessity.

A readiness probe had previously accepted beam because it returned the
expected short marker, while all ten actual event-to-prose calls failed response
shape. Therefore, the readiness marker is evidence of basic route
responsiveness, not evidence of narration quality or task compatibility.

## Routing change

The default Ollama preference order is now:

1. gemma4:31b-cloud - primary;
2. gemma4:31b - backup;
3. nemotron-3-ultra - final Ollama fallback.

Super, Nano, and Beam remain possible candidates for a later explicit
re-evaluation, but are excluded from the default runtime route because this
screen found a concrete quality or response-shape defect. The runtime still
requires authenticated interpret and narrate route probes before activating a
candidate.

## Limits and follow-up

The sample is small and each model saw each package only once. It supports
excluding the observed failures and choosing a conservative default; it does
not establish that the retained models are safe on all narration inputs, nor
does it compare latency under production load. Raw per-case outputs were not
archived with this note, so this is a summarized observation, not a fully
reproducible benchmark. The next quality step should repeat the same corpus at
least three times per candidate, preserve sanitized per-case outputs and
provider/model attribution, and add a separate human review of coherence and
style. Readiness, factual grounding, UI acceptance, and human playability must
continue to be reported separately.
