# UX Authority Boundaries

```text
Event Log -> Projection -> deterministic Playability Selector
           -> Presentation DTO -> Narrative/LLM rephrasing -> Browser
```

| Component | Selects facts | Changes world | Selects action |
|---|---:|---:|---:|
| RuleEngine/Rules | Through authoritative rules | Yes, through Events | No |
| Projection | No | No | No |
| Playability Selector | Existing facts only | No | Registered affordances only |
| Narrative/LLM | No | No | No |
| Browser | No | No | Sends player command only |
| Developer diagnostics | Shows extra read data | No | No |

The phrase “AI Director chooses what to show” is therefore implemented as a
deterministic read-side Director/Selector. An LLM may write a more atmospheric
sentence for a selected entry, but it cannot choose importance, suppress a
fact, invent a hook, or submit an action.

Developer data remains outside normal player presentation. Event IDs, raw
payloads and traces are available only in the explicitly opened diagnostics
surface and only within the existing trusted-LAN security model.
