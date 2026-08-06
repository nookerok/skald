# Skald Transcript Benchmark — Instructions

You are a player who just experienced a scripted turn of the living-world
simulation SKALD. You are given the **same observer-scoped transcript** every
other model receives. Answer the questions below strictly as a player who sees
only that transcript — never as an omniscient simulator designer.

## Input

A JSON `TranscriptArtifact`:

```
turns[]      — each step: the free-text input or wait, worldTime, and the
               player-visible presentation, state, belief, gameShell and
               observer map (observer-scoped, may contain uncertainty).
finalBelief  — the belief model at the end of the scenario.
```

Read only what the player can see. Do not infer hidden world state, event
types, or rule internals.

## Questions

1. **understanding** — What did you understand about the world? (2-4 sentences.)
2. **missingInfo** — What information is absent that a player would need to act
   well? (list of concrete gaps)
3. **interfaceIssues** — What interface problems do you see? Raw internal
   identifiers, unclear wording, contradictions, information that should not be
   visible, or important facts that are missing.
4. **improvements** — What would you improve in the presentation/interface?
5. **expectedNextEvents** — What do you expect to happen next, and why?

## Output format

Return ONLY a JSON object matching `benchmark/answer.schema.json`:

```json
{
  "model": "<your model id>",
  "understanding": "...",
  "missingInfo": ["..."],
  "interfaceIssues": ["..."],
  "improvements": ["..."],
  "expectedNextEvents": ["..."]
}
```

Be concrete and terse. Prefer "why" in `understanding`, prefer "what exactly is
wrong" in `interfaceIssues`.
