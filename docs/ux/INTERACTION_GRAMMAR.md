# UX Interaction Grammar

## Current registered intentions

```text
Move(direction)
Wait
Give(relation, target)
OpenJournal
FilterThread
OpenDiagnostics
```

Suggestions may show only actions with an existing command or read-only route.
The UI must not promise success; Rules remain authoritative.

## Future natural language

```text
player text -> parser/LLM interpretation -> finite registered intent
            -> ambiguity check -> clarification or command
```

Natural language must not create arbitrary Events, Rules or targets. An
ambiguous request is a clarification state, not permission to guess.

## Player-facing language

Normal UI hides Event names, IDs, JSON and Rule terminology. Developer
Diagnostics may expose safe technical detail under the existing trusted-LAN
constraint.
