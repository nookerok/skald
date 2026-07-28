# UX Capability Matrix

Statuses: `Current`, `Next`, `Future`, `Concept only`, `Rejected`,
`Needs architecture decision`.

| ID | Capability | Status | Missing dependency or constraint |
|---|---|---|---|
| UX-001 | Four-direction movement | Current | Existing command/API |
| UX-002 | Wait | Current | Existing wait API |
| UX-003 | Supported social actions | Current | Existing give command |
| UX-004 | Primary/notable presentation | Current | Backend selector and DTO |
| UX-005 | Turn Journal and Threads | Current | Historical replay API |
| UX-006 | Developer diagnostics | Current | Trusted-LAN restriction; no public auth |
| UX-007 | Responsive playable shell | Next | UX-1 implementation |
| UX-008 | Loading/reconnect/error states | Next | Client state contract |
| UX-009 | Trace/Hypothesis/Discovery views | Next | Discovery read model; Iteration 15 |
| UX-010 | Character identity onboarding | Next | Iteration 16 domain contract |
| UX-011 | Natural-language intents | Future | Finite intent registry and ambiguity policy |
| UX-012 | Inventory and item actions | Future | Item Events, Projection and API |
| UX-013 | NPC dialogue focus | Future | NPC observation/dialogue contract |
| UX-014 | Map and fog of war | Future | Location read model and navigation intents |
| UX-015 | Multiple characters/worlds | Future | Persistence tenancy and selection API |
| UX-016 | Write-capable offline mode | Future | Sync/conflict/idempotency design |
| UX-017 | Read-only offline journal cache | Candidate | Explicit stale-data contract |
| UX-018 | LLM chooses displayed facts | Rejected | Violates authority hierarchy |
| UX-019 | Scripted mandatory first-session path | Rejected | Conflicts with living-world agency |
| UX-020 | Full voice interaction | Concept only | Audio pipeline and command safety |

## Classification rule

An item cannot become `Current` merely because a mockup exists. It becomes
`Current` only when the command/read-model/API contract and acceptance test
exist. Concept screens must be labelled as non-functional in design artifacts.
