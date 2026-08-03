# ADR 0019: Player Map — Observer DTO Renderer

Status: accepted

## Context

The `ObserverMapDTO` provides observer-scoped spatial knowledge: locations,
landmarks and routes with `SpatialKnowledge` classification. The browser
receives only this DTO, never the truth `SpatialWorldProjection`.

However, the current DTO lacks route geometry for visualization. Routes carry
`fromLocationRef`/`toLocationRef` but no path coordinates. The browser cannot
draw a road without knowing its shape.

Additionally, there is no frontend map renderer. The Game Shell shows location
names and connected locations as text buttons, but no visual map.

## Decision

Create a pure presentation map renderer that visualizes `ObserverMapDTO` as
SVG/DOM. Extend the DTO with observer-safe route geometry.

### 1. Pure presentation renderer

The map renderer is a pure function: `ObserverMapDTO → DOM/SVG`. It does not
read Event Log, `ReadonlyWorld`, `SpatialWorldProjection` or BeliefModel.
All classification (observed/glimpsed/stale) is performed by the backend.

### 2. Route geometry extension

Add `geometry` field to `ObserverMapRoute`:

```ts
geometry:
  | { kind: "observed_path"; points: readonly ObserverMapPoint[] }
  | { kind: "directional_stub"; bearing: string }
  | null
```

Rules:
- `observed_path`: only for routes with `knowledge >= observed`.
- `directional_stub`: for glimpsed/unknown endpoints.
- `null`: route not yet visualizable.

### 3. Frontend module structure

```
map-client.js   — HTTP fetch with abort/timeout
map-state.js    —状态机 (idle/loading/ready/stale/error)
map-view.js     — SVG/DOM renderer (pure DTO → DOM)
map-layout.js   — coordinate projection (DTO coords → viewport)
map-legend.js   — legend rendering
map-accessibility.js — ARIA, keyboard, screen reader
```

### 4. Visual semantics

- `traversed` location: bright dot + label
- `observed` location: normal dot
- `glimpsed` location: dashed outline
- `stale` location: muted dot + stale marker
- `observed` route: thin line
- `glimpsed` route: dashed line
- Monolith `glimpsed`: bearing + distance, no coordinates

### 5. Game Shell integration

Map loads after presence ready. Command responses check map revision and
refresh if needed. Stale revisions are ignored.

### 6. Accessibility

- `role="region"` for map container
- `<title>` and `<desc>` in SVG
- Keyboard focus for each known point
- List fallback for screen readers
- `aria-live="polite"` for updates
- 44px touch targets on mobile

### 7. No gameplay actions

Map click opens evidence/detail only. No JourneyIntent, no movement commands,
no route planning.

## Consequences

- **New files**: 6 frontend modules in `packages/cli/public/`
- **DTO extension**: `ObserverMapRoute.geometry` field
- **Backend**: route geometry builder in `observer-map.ts`
- **Tests**: renderer purity, DTO rendering, layout, state, accessibility

## Definition of Done

`GET /map` returns `ObserverMapDTO` with route geometry. The SVG renderer
draws only known locations/landmarks/routes. Glimpsed monolith shows bearing
without coordinates. Stale/contradicted items are visually distinct. The map
does not generate gameplay commands. Desktop and mobile layouts work.
