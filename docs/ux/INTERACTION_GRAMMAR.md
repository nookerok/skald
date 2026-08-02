# UX Interaction Grammar

The intent grammar is a backend contract, not a list of UI buttons.
The player expresses intentions through the free-text composer. The composer
is the only action control; there is no D-pad, no verb buttons, no action
chips and no autocomplete that replaces the intent (ADR-0013 §8). Read-only
navigation controls (journal, knowledge and diagnostics) are not in-world
intentions.

## Current registered intentions

```text
Observe                          # осмотреться — surroundings only
Inspect                          # осмотреть/изучить <цель>; examine = alias
Listen                           # прислушаться — surroundings or <цель> (Slice 2)
Touch                            # коснуться <цели> — online-only (Slice 3)
Take                             # взять <предмет> — online-only (Slice 4)
Open                             # открыть <цель> — online-only (Slice 5)
ApplyForce                       # толкнуть/навалиться <цель> — online-only (Slice 6)
Give                             # отдать <предмет> <персонажу> — online-only (Slice 7)
Move(direction)                  # legacy, unchanged
Wait                             # legacy, unchanged
Give(relation, target)           # legacy social, unchanged
OpenJournal
FilterThread
OpenDiagnostics
```

The Interaction Model v1 pipeline (ADR-0013): player text → parser
normalization to a canonical verb from the fixed v1 set → `InteractionCommand`
→ `InteractionRequested` → gates (`duration_check` → target resolution →
law resolution) → fact outcomes. Target resolution and ambiguity are backend
Rules over `ReadonlyWorld`, never the parser and never the browser.

Ambiguity is an honest rejection with candidate names
(`ActionRejected(reason: "ambiguous_target")`), not a guess and not a
permanent clarification state. An ambiguous request never produces a Domain
Event with gameplay semantics.

Offline (UX-6.3 contract): only the inspect/examine intent is admissible
through the offline envelope; other v1 verbs are online-only until UX-6.4.

Suggestions may show only actions with an existing command or read-only route.
The UI must not promise success; Rules remain authoritative.

## Future natural language

```text
player text -> parser/LLM interpretation -> finite registered intent
            -> ambiguity check -> clarification or command
```

Natural language must not create arbitrary Events, Rules or targets. The LLM
may only paraphrase facts selected by the server; it never selects facts,
importance or actions.

## Player-facing language

Normal UI hides Event names, IDs, JSON and Rule terminology. Developer
Diagnostics may expose safe technical detail under the existing trusted-LAN
constraint.
