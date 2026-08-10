# ADR-0027: Historical evidence and discovery resolution

## Decision

Historical Canon accepts observable traces and research questions, not unverified causes. A compiled discovery definition declares support and contradiction criteria. The Discovery Journal derives `unresolved`, `supported`, `contradicted` or `inconclusive` from independent Event Log evidence.

Repeated copies of one Event are not independent evidence. Rules use distinct world times, locations and source Event IDs as declared by each definition. Contradictory evidence remains in the card and is never deleted when a hypothesis becomes supported.

## Runtime boundary

Discovery resolution is a read-side result and creates no Domain Event. Runtime reads only the compiled bundle and observer-scoped evidence. Proposals, review documents and reference images remain design-time inputs.
