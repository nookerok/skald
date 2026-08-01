# Observation Contract API v2.0

`@skald/observation` is the boundary package for observer-scoped knowledge.
It owns public types, runtime validation and JSON Schemas only. It does not
read the Event Log, Projection or network and it does not render UI.

The pure `ObservationAPI` contract exposes `observe`, `queryRelations`,
`queryHistory`, `listObservable`, `explainExistence` and `trace`. Implementations
belong to later engine packages and must preserve observer scope.

HTTP adapters must validate incoming DTOs with `parseBeliefModelDTO` or
`parseObservationRecord` before handing them to a renderer. A schema change
requires a new `schemaVersion` and an ADR.
