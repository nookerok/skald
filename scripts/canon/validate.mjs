// canon:validate — Canon Model linter (ADR-0021, WORLD_BIBLE_ARCHITECTURE.md §11.3).
// Exposes validateCanon() so every Canon consumer (the lint CLI and the World
// Bible generator) validates the same way. Checks, fail-fast via exit code 1:
//   - required fields and enum values (concept.schema.json / fact.schema.json)
//   - Fact.lifecycle <= Concept.lifecycle (A-10)
//   - Concept Graph acyclicity and existing relation targets (A-8)
//   - Canonical Anchors reference existing Canon concepts (3.6)
//   - Simulated/CoreSimulation concepts carry runtimeMapping or plannedRuntime (A-19)
//   - observability Impossible never combined with empty consequences (0.14)
//   - active concepts never reference Deprecated/Archived concepts (A-17)
//   - Not Simulated claims carry category/reason/consequences (A-21)
// Runs inside scripts/validate.sh; no network, no writes, deterministic.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCanon } from "./lib/load-canon.mjs";

const SCOPES = ["Universal", "Regional"];
const DOMAINS = ["Metaphysics", "Laws", "History", "Space", "Biology", "Culture", "Society", "Technology", "Entities"];
const SCALES = ["Eternal", "Epoch", "HistoricalEvent", "Seasonal", "Momentary"];
const MUTATIONS = ["Immutable", "Evolving", "Mutable"];
const LIFECYCLE = ["Experimental", "Proposed", "Canon", "Deprecated", "Archived"];
const DEPTHS = ["NarrativeOnly", "Observable", "Simulated", "CoreSimulation"];
const OBSERVABILITY = ["DirectObservation", "Artifact", "GeologicalTrace", "BiologicalTrace", "Testimony", "Ritual", "Astronomical", "MathematicalInference", "Impossible"];
const KNOWLEDGE_COST = ["Common", "Uncommon", "Rare", "Lost", "Impossible"];
const RELATION_TYPES = ["grounds", "causes", "locatedIn", "contains", "exemplifies", "predates", "dependsOn", "contradicts"];
const NS_CATEGORIES = ["PerformanceLimit", "CalibrationLimit", "DeterminismConstraint", "DesignChoice", "DeferredCapability"];
const DEEP_DEPTHS = new Set(["Simulated", "CoreSimulation"]);
const INACTIVE = new Set(["Deprecated", "Archived"]);
const ANCHOR_WARNING_THRESHOLD = 10;

const lifecycleRank = (value) => LIFECYCLE.indexOf(value);
const isEnum = (value, allowed) => allowed.includes(value);

/**
 * Validate the entire Canon Model. Returns the collected errors/warnings and
 * the loaded documents so callers render from exactly the validated data.
 */
export function validateCanon() {
  const errors = [];
  const warnings = [];

  function checkTemporalScope(scope, where) {
    if (!scope || typeof scope !== "object") {
      errors.push(`${where}: temporalScope is required`);
      return;
    }
    if (!isEnum(scope.scale, SCALES)) errors.push(`${where}: temporalScope.scale invalid: ${scope.scale}`);
    if (!isEnum(scope.mutation, MUTATIONS)) errors.push(`${where}: temporalScope.mutation invalid: ${scope.mutation}`);
  }

  const { documents, errors: loadErrors } = loadCanon();
  errors.push(...loadErrors);

  const concepts = new Map();
  const anchors = [];
  const claims = [];
  const compilerProjections = [];

  for (const doc of documents) {
    if (doc.kind === "unknown") {
      errors.push(`${doc.file}: unrecognized Canon document (expected concept/anchors/claims/tools/compilerProjection top key)`);
      continue;
    }
    if (doc.data?.schemaVersion !== 1) {
      errors.push(`${doc.file}: schemaVersion must be 1`);
    }
    if (doc.kind === "concept") {
      const concept = doc.data.concept;
      if (!concept?.id) {
        errors.push(`${doc.file}: concept.id is required`);
        continue;
      }
      if (concepts.has(concept.id)) {
        errors.push(`${doc.file}: duplicate concept id ${concept.id} (also in ${concepts.get(concept.id).file})`);
        continue;
      }
      concepts.set(concept.id, { concept, file: doc.file });
    }
    if (doc.kind === "anchors") anchors.push(...doc.data.anchors.map((a) => ({ ...a, file: doc.file })));
    if (doc.kind === "claims") claims.push(...doc.data.claims.map((c) => ({ ...c, file: doc.file })));
    if (doc.kind === "compilerProjection") {
      const projection = doc.data.compilerProjection;
      compilerProjections.push({ projection, file: doc.file });
      if (!projection?.id || !projection.regionId || !projection.compilerVersion) errors.push(doc.file + ": compilerProjection.id, regionId and compilerVersion are required");
      if (!Array.isArray(projection?.canonicalRefs) || projection.canonicalRefs.length === 0) errors.push(doc.file + ": compilerProjection.canonicalRefs must be a non-empty list");
      if (projection?.region?.sizeMetres !== 20000 || projection?.region?.tileSizeMetres !== 250 || projection?.region?.cellSizeMetres !== 1000) errors.push(doc.file + ": pilot compiler projection resolution must remain 20km / 250m / 1km");
      for (const [key, entries] of Object.entries({ locations: projection?.locations, landmarks: projection?.landmarks, relations: projection?.relations, travel: projection?.travel, observations: projection?.observations, discoveryDefinitions: projection?.discoveryDefinitions, simulationMetadata: projection?.simulationMetadata })) {
        if (!Array.isArray(entries) || entries.length === 0) errors.push(doc.file + ": compilerProjection." + key + " must be a non-empty list");
      }
      if (projection?.locations?.length !== 8 || projection?.landmarks?.length !== 5 || projection?.relations?.length !== 8 || projection?.travel?.length !== 8 || projection?.observations?.length !== 13) errors.push(doc.file + ": pilot compiler projection entity counts changed; review bootstrap parity explicitly");
      for (const [key, entries] of Object.entries({ hydrography: projection?.hydrography, elevation: projection?.elevation, toponymIndex: projection?.toponymIndex })) {
        if (!entries || typeof entries !== "object") errors.push(doc.file + ": compilerProjection." + key + " is required for region v4");
      }
      const hydro = projection?.hydrography;
      if (hydro) {
        for (const [key, entries] of Object.entries({ waterBodies: hydro.waterBodies, watercourses: hydro.watercourses, catchments: hydro.catchments, wetlands: hydro.wetlands })) {
          if (!Array.isArray(entries)) errors.push(doc.file + ": compilerProjection.hydrography." + key + " must be an array");
          for (const item of entries ?? []) if (item.status && item.status !== "canon") errors.push(doc.file + ": compilerProjection.hydrography." + key + " contains non-Canon item " + (item.id ?? "<missing>"));
        }
        if (hydro.watercourses?.length !== 2 || hydro.waterBodies?.length !== 1 || hydro.catchments?.length !== 1) errors.push(doc.file + ": accepted hydrography topology changed; review geography decisions explicitly");
        if ((hydro.wetlands ?? []).length !== 0) errors.push(doc.file + ": deferred wetlands must not enter runtime projection");
        if (JSON.stringify(hydro).match(/coast|tidal|estuary|delta/i)) errors.push(doc.file + ": unresolved southern water must not enable coast/tidal/estuary/delta simulation");
      }
      const elevation = projection?.elevation;
      if (elevation && (!Array.isArray(elevation.bands) || elevation.bands.length !== 4 || !Array.isArray(elevation.controlAreas) || elevation.controlAreas.length < 3 || !Array.isArray(elevation.constraints) || elevation.constraints.length < 2)) errors.push(doc.file + ": relative elevation projection is incomplete");
      const names = projection?.toponymIndex;
      if (names && (!Array.isArray(names.subjects) || names.subjects.length !== 13 || names.subjects.some((entry) => !entry.id || !entry.canonicalName || !Array.isArray(entry.aliases)))) errors.push(doc.file + ": reviewed toponym index is incomplete");
      for (const item of [...(projection?.locations ?? []), ...(projection?.landmarks ?? []), ...(projection?.relations ?? []), ...(projection?.observations ?? []), ...(projection?.content ?? []), ...(projection?.settlements ?? []), ...(projection?.discoveryDefinitions ?? []), ...(projection?.simulationMetadata ?? [])]) {
        if (!Array.isArray(item.canonicalRefs) || item.canonicalRefs.length === 0) errors.push(doc.file + ": compilerProjection entry " + (item.id ?? item.relationId ?? item.subjectId ?? item.settlementId ?? "<missing>") + " requires canonicalRefs");
      }
    }
  }

  for (const { concept, file } of concepts.values()) {
    const where = `${file} [${concept.id}]`;
    if (!isEnum(concept.scope, SCOPES)) errors.push(`${where}: scope invalid: ${concept.scope}`);
    if (!isEnum(concept.domain, DOMAINS)) errors.push(`${where}: domain invalid: ${concept.domain}`);
    if (!isEnum(concept.lifecycle, LIFECYCLE)) errors.push(`${where}: lifecycle invalid: ${concept.lifecycle}`);
    if (!isEnum(concept.simulationDepth, DEPTHS)) errors.push(`${where}: simulationDepth invalid: ${concept.simulationDepth}`);
    checkTemporalScope(concept.temporalScope, where);
    if (!concept.provenance?.proposedBy || !concept.provenance?.acceptedBy) {
      errors.push(`${where}: provenance.proposedBy and provenance.acceptedBy are required (A-14)`);
    }
    if (INACTIVE.has(concept.lifecycle) && !concept.deprecatedReason) {
      warnings.push(`${where}: ${concept.lifecycle} concept should carry deprecatedReason`);
    }
    if (DEEP_DEPTHS.has(concept.simulationDepth)) {
      const hasMapping = concept.runtimeMapping && Object.keys(concept.runtimeMapping).length > 0;
      if (!hasMapping && !concept.plannedRuntime) {
        errors.push(`${where}: ${concept.simulationDepth} concept requires runtimeMapping or plannedRuntime (A-19)`);
      }
    }
    for (const relation of concept.relations ?? []) {
      if (!isEnum(relation.type, RELATION_TYPES)) errors.push(`${where}: relation type invalid: ${relation.type}`);
      if (!relation.target) errors.push(`${where}: relation target is required`);
    }
    const factIds = new Set();
    for (const fact of concept.facts ?? []) {
      const fwhere = `${where} fact ${fact.id ?? "<missing>"}`;
      if (!fact.id) errors.push(`${fwhere}: fact.id is required`);
      if (fact.id && factIds.has(fact.id)) errors.push(`${fwhere}: duplicate fact id`);
      if (fact.id) factIds.add(fact.id);
      if (!fact.statement) errors.push(`${fwhere}: statement is required`);
      if (!fact.type) errors.push(`${fwhere}: type is required`);
      checkTemporalScope(fact.temporalScope, fwhere);
      if (!fact.provenance?.type) errors.push(`${fwhere}: provenance.type is required`);
      if (!Array.isArray(fact.consequences) || fact.consequences.length === 0) {
        errors.push(`${fwhere}: consequences must be a non-empty list (A-2)`);
      }
      if (fact.observability && !isEnum(fact.observability, OBSERVABILITY)) {
        errors.push(`${fwhere}: observability invalid: ${fact.observability}`);
      }
      if (fact.knowledgeCost && !isEnum(fact.knowledgeCost, KNOWLEDGE_COST)) {
        errors.push(`${fwhere}: knowledgeCost invalid: ${fact.knowledgeCost}`);
      }
      if (fact.observability === "Impossible" && (!Array.isArray(fact.consequences) || fact.consequences.length === 0)) {
        errors.push(`${fwhere}: observability Impossible with no consequences is forbidden (0.14)`);
      }
      if (fact.lifecycle) {
        if (!isEnum(fact.lifecycle, LIFECYCLE)) {
          errors.push(`${fwhere}: lifecycle invalid: ${fact.lifecycle}`);
        } else if (isEnum(concept.lifecycle, LIFECYCLE) && lifecycleRank(fact.lifecycle) > lifecycleRank(concept.lifecycle)) {
          errors.push(`${fwhere}: fact lifecycle ${fact.lifecycle} exceeds concept lifecycle ${concept.lifecycle} (A-10)`);
        }
      }
    }
  }

  // Compiler projection references are checked after all concepts/facts load.
  const canonicalIds = new Set([...concepts.keys(), ...[...concepts.values()].flatMap(({ concept }) => (concept.facts ?? []).map((fact) => fact.id))]);
  const collectCanonicalRefs = (value, out = []) => {
    if (!value || typeof value !== "object") return out;
    if (Array.isArray(value)) { for (const item of value) collectCanonicalRefs(item, out); return out; }
    for (const ref of value.canonicalRefs ?? []) out.push(ref);
    for (const [key, child] of Object.entries(value)) if (key !== "canonicalRefs" && child && typeof child === "object") collectCanonicalRefs(child, out);
    return out;
  };
  for (const { projection, file } of compilerProjections) {
    for (const ref of [...(projection?.canonicalRefs ?? []), ...collectCanonicalRefs(projection)]) {
      if (!canonicalIds.has(ref)) errors.push(file + ": compilerProjection references unknown Canon id " + ref);
    }
  }

  // Reference integrity + graph acyclicity (A-8).
  const edges = [];
  for (const { concept, file } of concepts.values()) {
    for (const relation of concept.relations ?? []) {
      if (!relation.target) continue;
      const target = concepts.get(relation.target);
      if (!target) {
        errors.push(`${file} [${concept.id}]: relation ${relation.type} targets unknown concept ${relation.target}`);
        continue;
      }
      if (!INACTIVE.has(concept.lifecycle) && INACTIVE.has(target.concept.lifecycle)) {
        errors.push(`${file} [${concept.id}]: active concept references ${target.concept.lifecycle} concept ${relation.target} (A-17)`);
      }
      edges.push([concept.id, relation.target]);
    }
  }
  {
    const state = new Map();
    const adjacency = new Map();
    for (const [from, to] of edges) {
      if (!adjacency.has(from)) adjacency.set(from, []);
      adjacency.get(from).push(to);
    }
    const visit = (node, path) => {
      state.set(node, 1);
      for (const next of adjacency.get(node) ?? []) {
        if (state.get(next) === 1) {
          errors.push(`concept graph cycle detected: ${[...path, node, next].join(" -> ")} (A-8)`);
          continue;
        }
        if (!state.has(next)) visit(next, [...path, node]);
      }
      state.set(node, 2);
    };
    for (const id of concepts.keys()) if (!state.has(id)) visit(id, []);
  }

  // Anchors (3.6).
  if (anchors.length > ANCHOR_WARNING_THRESHOLD) {
    warnings.push(`anchor registry holds ${anchors.length} anchors; anchors must stay few (3.6)`);
  }
  for (const anchor of anchors) {
    const where = `${anchor.file} [${anchor.id ?? "<missing>"}]`;
    if (!anchor.id) errors.push(`${where}: anchor.id is required`);
    if (anchor.obligation !== "required") errors.push(`${where}: obligation invalid: ${anchor.obligation}`);
    if (!anchor.regionId) errors.push(`${where}: regionId is required`);
    const target = anchor.conceptId ? concepts.get(anchor.conceptId) : null;
    if (!target) {
      errors.push(`${where}: anchor references unknown concept ${anchor.conceptId}`);
    } else if (target.concept.lifecycle !== "Canon") {
      errors.push(`${where}: anchor references non-Canon concept ${anchor.conceptId} (${target.concept.lifecycle})`);
    }
  }

  // Not Simulated claims (A-21, A-22).
  for (const claim of claims) {
    const where = `${claim.file} [${claim.id ?? "<missing>"}]`;
    if (!claim.id) errors.push(`${where}: claim.id is required`);
    if (!claim.statement) errors.push(`${where}: statement is required`);
    if (!isEnum(claim.category, NS_CATEGORIES)) errors.push(`${where}: category invalid: ${claim.category}`);
    if (!claim.reason) errors.push(`${where}: reason is required`);
    if (!Array.isArray(claim.consequences) || claim.consequences.length === 0) {
      errors.push(`${where}: consequences must be a non-empty list (A-21)`);
    }
    if (claim.category !== "DeterminismConstraint" && !claim.reviewAfter) {
      warnings.push(`${where}: non-constitutional claim should carry reviewAfter`);
    }
  }

  return {
    errors,
    warnings,
    documents,
    conceptCount: concepts.size,
    anchorCount: anchors.length,
    claimCount: claims.length,
  };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const { errors, warnings, conceptCount, anchorCount, claimCount } = validateCanon();
  for (const warning of warnings) console.warn(`[canon:validate] warning: ${warning}`);
  if (errors.length > 0) {
    for (const error of errors) console.error(`[canon:validate] error: ${error}`);
    console.error(`[canon:validate] FAIL (${errors.length} error(s), ${warnings.length} warning(s))`);
    process.exit(1);
  }
  console.log(`[canon:validate] PASS (${conceptCount} concepts, ${anchorCount} anchors, ${claimCount} not-simulated claims, ${warnings.length} warning(s))`);
}
