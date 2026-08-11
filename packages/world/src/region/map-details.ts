import type { SpatialBounds, SpatialKnowledge } from "./types.js";
import type { ObserverSpatialKnowledge } from "./observer-knowledge.js";

export interface ObserverMapDetailDescriptor {
  readonly id: string;
  readonly coverageBounds: SpatialBounds;
}

interface DetailUnlockPolicy extends ObserverMapDetailDescriptor {
  readonly subjectKind: "location" | "landmark";
  readonly subjectId: string;
  readonly minimumKnowledge: Exclude<SpatialKnowledge, "rumored">;
}

const RANK: Readonly<Record<SpatialKnowledge, number>> = Object.freeze({
  rumored: 1,
  glimpsed: 2,
  observed: 3,
  traversed: 4,
});

const DETAIL_POLICIES: readonly DetailUnlockPolicy[] = Object.freeze([
  {
    id: "central-valley",
    coverageBounds: { minXMetres: 5_000, minYMetres: 7_000, maxXMetres: 12_000, maxYMetres: 14_000 },
    subjectKind: "location",
    subjectId: "river_waystation",
    minimumKnowledge: "traversed",
  },
  {
    id: "blackwood-crater",
    coverageBounds: { minXMetres: 0, minYMetres: 0, maxXMetres: 8_000, maxYMetres: 17_000 },
    subjectKind: "location",
    subjectId: "blackwood_edge",
    minimumKnowledge: "observed",
  },
  {
    id: "northern-pass",
    coverageBounds: { minXMetres: 5_000, minYMetres: 14_000, maxXMetres: 15_000, maxYMetres: 20_000 },
    subjectKind: "location",
    subjectId: "high_pass",
    minimumKnowledge: "observed",
  },
  {
    id: "eastern-uplands",
    coverageBounds: { minXMetres: 12_000, minYMetres: 10_000, maxXMetres: 20_000, maxYMetres: 18_000 },
    subjectKind: "landmark",
    subjectId: "old_ruins",
    minimumKnowledge: "observed",
  },
  {
    id: "southern-borough",
    coverageBounds: { minXMetres: 7_000, minYMetres: 3_000, maxXMetres: 17_000, maxYMetres: 10_000 },
    subjectKind: "location",
    subjectId: "southern_borough",
    minimumKnowledge: "observed",
  },
]);

export function buildAvailableObserverMapDetails(
  regionId: string | null,
  knowledge: ObserverSpatialKnowledge,
): readonly ObserverMapDetailDescriptor[] {
  if (regionId !== "riverwatch-basin") return Object.freeze([]);
  const details: ObserverMapDetailDescriptor[] = [{
    id: "overview",
    coverageBounds: { minXMetres: 0, minYMetres: 0, maxXMetres: 20_000, maxYMetres: 20_000 },
  }];
  for (const policy of DETAIL_POLICIES) {
    const map = policy.subjectKind === "location" ? knowledge.locations : knowledge.landmarks;
    const observation = map.get(policy.subjectId);
    if (observation && RANK[observation.knowledge] >= RANK[policy.minimumKnowledge]) {
      details.push({ id: policy.id, coverageBounds: policy.coverageBounds });
    }
  }
  return Object.freeze(details);
}

export const RIVERWATCH_DETAIL_POLICIES = DETAIL_POLICIES;
