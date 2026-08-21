import type {
  ObserverMapPoint,
  ObserverMapTerrainPatch,
  ObserverMapTerrainRegion,
  TerrainSurface,
} from "./types.js";

interface TerrainGroup {
  readonly key: string;
  readonly patches: ObserverMapTerrainPatch[];
}

interface Edge {
  readonly from: ObserverMapPoint;
  readonly to: ObserverMapPoint;
}

function pointKey(point: ObserverMapPoint): string {
  return `${point.xMetres}:${point.yMetres}`;
}

function edgeKey(edge: Edge): string {
  return `${pointKey(edge.from)}>${pointKey(edge.to)}`;
}

function reverseEdgeKey(edge: Edge): string {
  return `${pointKey(edge.to)}>${pointKey(edge.from)}`;
}

function terrainKey(patch: ObserverMapTerrainPatch): string {
  return `${patch.surface}:${patch.elevationBand}:${patch.slopeBand}`;
}

function touches(a: ObserverMapTerrainPatch, b: ObserverMapTerrainPatch): boolean {
  const horizontal = (
    (a.bounds.maxXMetres === b.bounds.minXMetres || a.bounds.minXMetres === b.bounds.maxXMetres)
    && a.bounds.minYMetres < b.bounds.maxYMetres
    && a.bounds.maxYMetres > b.bounds.minYMetres
  );
  const vertical = (
    (a.bounds.maxYMetres === b.bounds.minYMetres || a.bounds.minYMetres === b.bounds.maxYMetres)
    && a.bounds.minXMetres < b.bounds.maxXMetres
    && a.bounds.maxXMetres > b.bounds.minXMetres
  );
  return horizontal || vertical;
}

function groupPatches(patches: readonly ObserverMapTerrainPatch[]): readonly TerrainGroup[] {
  const remaining = patches.map((patch) => ({ patch, used: false }));
  const groups: TerrainGroup[] = [];
  for (const entry of remaining) {
    if (entry.used) continue;
    const key = terrainKey(entry.patch);
    const queue = [entry];
    entry.used = true;
    const group: ObserverMapTerrainPatch[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      group.push(current.patch);
      for (const candidate of remaining) {
        if (candidate.used || terrainKey(candidate.patch) !== key) continue;
        if (!touches(current.patch, candidate.patch)) continue;
        candidate.used = true;
        queue.push(candidate);
      }
    }
    groups.push({ key, patches: group });
  }
  return groups;
}

function patchEdges(patch: ObserverMapTerrainPatch): readonly Edge[] {
  const { minXMetres, minYMetres, maxXMetres, maxYMetres } = patch.bounds;
  return [
    { from: { xMetres: minXMetres, yMetres: minYMetres }, to: { xMetres: maxXMetres, yMetres: minYMetres } },
    { from: { xMetres: maxXMetres, yMetres: minYMetres }, to: { xMetres: maxXMetres, yMetres: maxYMetres } },
    { from: { xMetres: maxXMetres, yMetres: maxYMetres }, to: { xMetres: minXMetres, yMetres: maxYMetres } },
    { from: { xMetres: minXMetres, yMetres: maxYMetres }, to: { xMetres: minXMetres, yMetres: minYMetres } },
  ];
}

function boundaryEdges(group: TerrainGroup): readonly Edge[] {
  const edges = new Map<string, Edge>();
  for (const patch of group.patches) {
    for (const edge of patchEdges(patch)) {
      const reverse = reverseEdgeKey(edge);
      if (edges.has(reverse)) edges.delete(reverse);
      else edges.set(edgeKey(edge), edge);
    }
  }
  return [...edges.values()];
}

function simplifyPolygon(points: readonly ObserverMapPoint[]): readonly ObserverMapPoint[] {
  if (points.length < 4) return points;
  const result: ObserverMapPoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length]!;
    const point = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const abx = point.xMetres - previous.xMetres;
    const aby = point.yMetres - previous.yMetres;
    const bcx = next.xMetres - point.xMetres;
    const bcy = next.yMetres - point.yMetres;
    if (abx * bcy === aby * bcx) continue;
    result.push({ xMetres: point.xMetres, yMetres: point.yMetres });
  }
  return result.length >= 3 ? result : points;
}

function edgeLoops(edges: readonly Edge[]): readonly (readonly ObserverMapPoint[])[] {
  const pending = new Map(edges.map((edge) => [edgeKey(edge), edge]));
  const loops: ObserverMapPoint[][] = [];
  while (pending.size > 0) {
    const first = pending.values().next().value as Edge;
    pending.delete(edgeKey(first));
    const loop: ObserverMapPoint[] = [{ ...first.from }, { ...first.to }];
    let current = first.to;
    while (pointKey(current) !== pointKey(first.from)) {
      const nextEntry = [...pending.entries()].find(([, edge]) => pointKey(edge.from) === pointKey(current));
      if (!nextEntry) break;
      pending.delete(nextEntry[0]);
      current = nextEntry[1].to;
      loop.push({ ...current });
    }
    if (loop.length >= 4 && pointKey(loop[0]!) === pointKey(loop.at(-1)!)) loop.pop();
    if (loop.length >= 3) loops.push([...simplifyPolygon(loop)]);
  }
  return loops;
}

function parseTerrainKey(key: string): { surface: TerrainSurface; elevationBand: number; slopeBand: number } {
  const [surface, elevationBand, slopeBand] = key.split(":");
  return { surface: surface as TerrainSurface, elevationBand: Number(elevationBand), slopeBand: Number(slopeBand) };
}

/**
 * Merge observer-visible rectangular terrain evidence into deterministic
 * polygon territories. Hidden canonical tiles never enter this function.
 */
export function buildObserverTerrainRegions(
  patches: readonly ObserverMapTerrainPatch[],
): readonly ObserverMapTerrainRegion[] {
  const regions: ObserverMapTerrainRegion[] = [];
  for (const group of groupPatches(patches)) {
    const loops = edgeLoops(boundaryEdges(group));
    const metadata = parseTerrainKey(group.key);
    for (const polygon of loops) regions.push(Object.freeze({ polygon: Object.freeze(polygon), ...metadata }));
  }
  return Object.freeze(regions);
}

/** Stable FNV-1a seed for presentation-only geometry. */
export function stableObserverSeed(...parts: readonly (string | number)[]): string {
  let hash = 0x811c9dc5;
  const value = parts.join(":");
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(36);
}
