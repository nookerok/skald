import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseYaml } from "./lib/mini-yaml.mjs";
import { loadCanon } from "./lib/load-canon.mjs";

const REQUIRED_COVERAGE = ["region_boundary","mountain_range","mountain_pass","valley","river","tributary","lake","forest","plain","wetland","coast","elevation_hierarchy"];
const FORBIDDEN_RUNTIME_KEYS = new Set(["canonicalId","eventType","runtimeMapping","canonicalRefs","bootstrapEvent"]);
const FEATURE_KINDS = new Set(["region_boundary","mountain_range","mountain_pass","valley","river","tributary","lake","forest","plain","wetland","coast","ridge","depression","landmark"]);
const PROPOSAL_STATUSES = new Set(["proposed", "ambiguous"]);

function pngDimensions(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
function readJson(path, errors) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { errors.push(path + ": " + error.message); return null; }
}
function readYaml(path, errors) {
  try { return parseYaml(readFileSync(path, "utf8"), path); }
  catch (error) { errors.push(path + ": " + error.message); return null; }
}
export function validateRegionAuthoring(rootDir = ".") {
  const errors = [];
  const canon = loadCanon(resolve(rootDir, "docs/canon"));
  errors.push(...canon.errors);
  const canonIds = new Set();
  for (const document of canon.documents) {
    const root = document.data?.concept ?? document.data?.anchors ?? document.data?.claims;
    if (root?.id) canonIds.add(root.id);
    for (const fact of root?.facts ?? []) if (fact.id) canonIds.add(fact.id);
    for (const anchor of root?.items ?? []) if (anchor.id) canonIds.add(anchor.id);
  }
  const manifestPath = resolve(rootDir, "docs/worldbuilding/pilot-region/reference/artifact-manifest.yaml");
  const imagePath = resolve(rootDir, "docs/worldbuilding/pilot-region/reference/region-source.png");
  const observationPath = resolve(rootDir, "docs/worldbuilding/pilot-region/interpretation/visual-observation.json");
  const proposalPath = resolve(rootDir, "docs/worldbuilding/pilot-region/proposals/pilot-region-proposal-v1.yaml");
  const reviewPath = resolve(rootDir, "docs/worldbuilding/pilot-region/reviews/pilot-region-review-v1.yaml");
  const historicalProposalPath = resolve(rootDir, "docs/worldbuilding/pilot-region/proposals/historical-layer-proposal-v1.yaml");
  const historicalReviewPath = resolve(rootDir, "docs/worldbuilding/pilot-region/reviews/historical-layer-review-v1.yaml");
  const toponymyPath = resolve(rootDir, "docs/worldbuilding/pilot-region/toponymy/toponym-proposals.yaml");
  const gapPath = resolve(rootDir, "docs/worldbuilding/pilot-region/interpretation/geography-gap-register.yaml");
  const hydroObservationPath = resolve(rootDir, "docs/worldbuilding/pilot-region/interpretation/hydrography-observation.json");
  const elevationObservationPath = resolve(rootDir, "docs/worldbuilding/pilot-region/interpretation/elevation-observation.json");
  const hydroProposalPath = resolve(rootDir, "docs/worldbuilding/pilot-region/proposals/pilot-region-hydrography-proposal-v1.yaml");
  const geographyReviewPath = resolve(rootDir, "docs/worldbuilding/pilot-region/reviews/pilot-region-geography-review-v2.yaml");
  const toponymReviewPath = resolve(rootDir, "docs/worldbuilding/pilot-region/reviews/pilot-region-toponym-review-v1.yaml");
  const manifest = readYaml(manifestPath, errors);
  const observation = readJson(observationPath, errors);
  const proposal = readYaml(proposalPath, errors)?.proposal;
  const review = readYaml(reviewPath, errors)?.review;
  const historicalProposal = readYaml(historicalProposalPath, errors)?.proposal;
  const historicalReview = readYaml(historicalReviewPath, errors)?.review;
  const toponymy = readYaml(toponymyPath, errors);
  const gapRegister = readYaml(gapPath, errors);
  const hydroObservation = readJson(hydroObservationPath, errors);
  const elevationObservation = readJson(elevationObservationPath, errors);
  const hydroProposal = readYaml(hydroProposalPath, errors)?.proposal;
  const geographyReview = readYaml(geographyReviewPath, errors)?.review;
  const toponymReview = readYaml(toponymReviewPath, errors)?.review;
  const artifact = manifest?.artifact;

  if (!artifact || artifact.role !== "reference_artifact" || artifact.provenance?.authoringOnly !== true || artifact.provenance?.runtimeAllowed !== false) errors.push("reference manifest must mark the image authoringOnly=true and runtimeAllowed=false");
  if (!artifact?.provenance?.receivedAt || !artifact?.provenance?.sourceKind) errors.push("reference manifest provenance requires receivedAt and sourceKind");
  if (artifact?.registration?.method !== "anchor_based_oblique" || !Array.isArray(artifact?.registration?.anchors) || artifact.registration.anchors.length < 2) errors.push("reference manifest requires at least two registration anchors");
  if (artifact?.file?.path !== "region-source.png") errors.push("reference manifest path must be region-source.png");
  try {
    const image = readFileSync(imagePath);
    const dimensions = pngDimensions(image);
    const digest = createHash("sha256").update(image).digest("hex");
    if (!dimensions) errors.push("reference artifact is not a PNG");
    if (dimensions && (dimensions.width !== artifact?.file?.widthPx || dimensions.height !== artifact?.file?.heightPx)) errors.push("reference manifest dimensions do not match the PNG");
    if (artifact?.file?.sha256 !== digest) errors.push("reference manifest sha256 does not match the PNG");
  } catch (error) { errors.push("reference artifact unavailable: " + error.message); }

  if (observation?.schemaVersion !== 1 || observation.regionId !== "riverwatch-basin" || observation.coordinateSystem !== "normalized_image") errors.push("visual observation must use schemaVersion 1, pilot region and normalized_image coordinates");
  for (const category of REQUIRED_COVERAGE) if (!observation?.coverage?.[category]?.status) errors.push("visual observation coverage missing " + category);
  const featureIds = new Set();
  for (const feature of observation?.features ?? []) {
    if (!feature.id || featureIds.has(feature.id)) errors.push("visual observation feature id missing or duplicated: " + (feature.id || "<missing>"));
    if (feature.id) featureIds.add(feature.id);
    if (!FEATURE_KINDS.has(feature.kind)) errors.push(feature.id + ": unsupported feature kind");
    if (feature.status !== "observed") errors.push(feature.id + ": status must be observed");
    if (typeof feature.approximateSize !== "string" || feature.approximateSize.length === 0) errors.push(feature.id + ": approximateSize required");
    if (feature.geometry?.coordinateSystem !== "normalized_image") errors.push(feature.id + ": geometry coordinateSystem must be normalized_image");
    if (!Array.isArray(feature.relations) || !Array.isArray(feature.simulationImportance)) errors.push(feature.id + ": relations and simulationImportance must be arrays");
    const bounds = feature.geometry?.bounds;
    if (bounds) {
      for (const key of ["minX","minY","maxX","maxY"]) if (typeof bounds[key] !== "number" || bounds[key] < 0 || bounds[key] > 1) errors.push(feature.id + ": " + key + " must be in [0,1]");
      if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) errors.push(feature.id + ": geometry bounds inverted");
    }
    if (typeof feature.evidence?.confidence !== "number" || feature.evidence.confidence < 0 || feature.evidence.confidence > 1) errors.push(feature.id + ": evidence confidence must be in [0,1]");
    for (const key of FORBIDDEN_RUNTIME_KEYS) if (key in feature) errors.push(feature.id + ": forbidden runtime key " + key);
  }

  if (!toponymy || toponymy.regionId !== "riverwatch-basin" || toponymy.status !== "proposed" || !Array.isArray(toponymy.proposals) || toponymy.proposals.length === 0) errors.push("toponym proposals must be a non-empty proposed list for the pilot region");
  const toponymIds = new Set();
  const toponymAliases = new Map();
  for (const entry of toponymy?.proposals ?? []) {
    if (!entry.proposalId || !entry.subjectId || toponymIds.has(entry.subjectId)) errors.push("toponym proposalId/subjectId missing or duplicated: " + (entry.subjectId || "<missing>"));
    if (entry.subjectId) toponymIds.add(entry.subjectId);
    for (const key of ["name","languageLayer","cultureRef","rootMeaning","etymology","historicalAge","geographicReason","status"]) if (!entry[key]) errors.push((entry.subjectId || "<missing>") + ": toponym field required: " + key);
    if (!Array.isArray(entry.aliases) || entry.aliases.length === 0) errors.push((entry.subjectId || "<missing>") + ": reviewed toponym requires at least one alias");
    for (const alias of entry.aliases ?? []) { const key = String(alias).trim().toLocaleLowerCase(); if (!key) errors.push((entry.subjectId || "<missing>") + ": alias must not be empty"); else if (toponymAliases.has(key) && toponymAliases.get(key) !== entry.subjectId) errors.push((entry.subjectId || "<missing>") + ": alias collision with " + toponymAliases.get(key) + ": " + alias); else toponymAliases.set(key, entry.subjectId); }
    if (!["proposed","canon_label"].includes(entry.status)) errors.push(entry.subjectId + ": invalid toponym status");
  }

  const gapIds = new Set();
  if (!gapRegister || gapRegister.schemaVersion !== 1 || gapRegister.regionId !== "riverwatch-basin" || !Array.isArray(gapRegister.gaps) || gapRegister.gaps.length === 0) errors.push("geography gap register must be a non-empty schemaVersion 1 list");
  for (const gap of gapRegister?.gaps ?? []) {
    if (!gap.id || gapIds.has(gap.id)) errors.push("gap id missing or duplicated: " + (gap.id || "<missing>"));
    if (gap.id) gapIds.add(gap.id);
    if (!gap.subjectId || !gap.question || !Array.isArray(gap.candidates) || gap.candidates.length === 0) errors.push((gap.id || "<missing>") + ": gap requires subjectId, question and candidates");
    if (!["ambiguous", "not_observed", "observed_relative_only", "resolved"].includes(gap.currentStatus)) errors.push((gap.id || "<missing>") + ": invalid gap status");
    if (gap.currentStatus !== "resolved" && (!Array.isArray(gap.evidenceRefs) || gap.evidenceRefs.length === 0 || !gap.resolutionRequired || !gap.responsible || !gap.lifecycle)) errors.push((gap.id || "<missing>") + ": unresolved gap requires evidence, resolutionRequired, responsible and lifecycle");
  }

  if (!hydroObservation || hydroObservation.schemaVersion !== 1 || hydroObservation.regionId !== "riverwatch-basin" || hydroObservation.coordinateSystem !== "normalized_image") errors.push("hydrography observation must use schemaVersion 1 and normalized_image");
  const hydroBodyIds = new Set((hydroObservation?.waterBodies ?? []).map((entry) => entry.id));
  const hydroCourseIds = new Set((hydroObservation?.watercourses ?? []).map((entry) => entry.id));
  if (hydroBodyIds.size !== (hydroObservation?.waterBodies ?? []).length || hydroCourseIds.size !== (hydroObservation?.watercourses ?? []).length) errors.push("hydrography observation ids must be unique");
  for (const body of hydroObservation?.waterBodies ?? []) {
    if (!body.id || !body.geometry || body.geometry.coordinateSystem !== "normalized_image" || !Array.isArray(body.evidenceRefs) || typeof body.confidence !== "number" || body.confidence < 0 || body.confidence > 1) errors.push((body.id || "<missing>") + ": invalid observed water body");
  }
  for (const course of hydroObservation?.watercourses ?? []) {
    if (!course.id || !course.sourceRef || !course.sinkRef || !Array.isArray(course.evidenceRefs) || typeof course.confidence !== "number" || course.confidence < 0 || course.confidence > 1) errors.push((course.id || "<missing>") + ": watercourse requires source, sink, evidence and confidence in [0,1]");
    if (course.sinkRef !== "river_basin" && !hydroBodyIds.has(course.sinkRef)) errors.push((course.id || "<missing>") + ": dangling observed sink");
    if (course.geometry?.coordinateSystem !== "normalized_image") errors.push((course.id || "<missing>") + ": observed geometry coordinate system mismatch");
  }
  for (const wetland of hydroObservation?.wetlands ?? []) { if (!hydroBodyIds.has(wetland.waterBodyRef)) errors.push((wetland.id || "<missing>") + ": dangling wetland waterBodyRef"); if (typeof wetland.confidence !== "number" || wetland.confidence < 0 || wetland.confidence > 1) errors.push((wetland.id || "<missing>") + ": wetland confidence must be in [0,1]"); }
  const hydroEdges = new Map((hydroObservation?.watercourses ?? []).map((course) => [course.id, course.sinkRef]));
  const visiting = new Set(); const visited = new Set();
  const visitHydro = (id) => { if (visiting.has(id)) { errors.push("hydrography observation contains a topology cycle at " + id); return; } if (visited.has(id)) return; visiting.add(id); const sink = hydroEdges.get(id); if (sink && hydroEdges.has(sink)) visitHydro(sink); visiting.delete(id); visited.add(id); };
  for (const id of hydroEdges.keys()) visitHydro(id);

  if (!elevationObservation || elevationObservation.schemaVersion !== 1 || elevationObservation.regionId !== "riverwatch-basin" || elevationObservation.coordinateSystem !== "normalized_image") errors.push("elevation observation must use schemaVersion 1 and normalized_image");
  const elevationBandIds = new Set((elevationObservation?.elevationBands ?? []).map((entry) => entry.id));
  const elevationRanks = new Set();
  for (const band of elevationObservation?.elevationBands ?? []) { if (!band.id || elevationBandIds.size !== (elevationObservation?.elevationBands ?? []).length) errors.push("elevation band ids must be unique"); if (elevationRanks.has(band.rank)) errors.push("elevation band ranks must be unique"); elevationRanks.add(band.rank); if (Object.keys(band).some((key) => /absolute|metres|height/i.test(key))) errors.push((band.id || "<missing>") + ": relative elevation observation must not contain exact heights"); }
  for (const area of elevationObservation?.controlAreas ?? []) { if (!elevationBandIds.has(area.bandRef)) errors.push((area.id || "<missing>") + ": control area references unknown band"); if (area.geometry?.coordinateSystem !== "normalized_image") errors.push((area.id || "<missing>") + ": control area coordinate system mismatch"); }
  for (const constraint of elevationObservation?.constraints ?? []) if (!constraint.id || !constraint.kind || !constraint.subject || !constraint.reference || !Array.isArray(constraint.evidenceRefs)) errors.push((constraint.id || "<missing>") + ": invalid elevation constraint");

  const hydroProposalIds = new Set();
  if (!hydroProposal || hydroProposal.status !== "proposed" || hydroProposal.regionId !== "riverwatch-basin") errors.push("hydrography proposal must remain proposed and reference the pilot region");
  for (const group of ["waterBodies", "watercourses", "wetlands", "catchments"]) for (const entry of hydroProposal?.[group] ?? []) {
    if (!entry.proposalId || hydroProposalIds.has(entry.proposalId)) errors.push("hydrography proposal id missing or duplicated: " + (entry.proposalId || "<missing>"));
    if (entry.proposalId) hydroProposalIds.add(entry.proposalId);
    if (!Array.isArray(entry.evidenceRefs) || entry.evidenceRefs.length === 0 || typeof entry.confidence !== "number" || entry.confidence < 0 || entry.confidence > 1 || !["proposed", "ambiguous"].includes(entry.status)) errors.push((entry.proposalId || "<missing>") + ": invalid hydrography proposal lifecycle or confidence");
    if (entry.classificationStatus && !["ambiguous", "not_observed", "observed_relative_only", "resolved"].includes(entry.classificationStatus)) errors.push((entry.proposalId || "<missing>") + ": incompatible water classification status");
    if (entry.subjectId === "southern_water_body" && entry.classificationStatus !== "ambiguous") errors.push((entry.proposalId || "<missing>") + ": southern water must remain classification-ambiguous");
  }
  const proposedCourses = new Set((hydroProposal?.watercourses ?? []).map((entry) => entry.subjectId));
  for (const course of hydroProposal?.watercourses ?? []) { if (!course.source || !course.sink) errors.push(course.proposalId + ": watercourse requires source and sink"); if (course.sink?.type === "confluence" && !proposedCourses.has(course.sink.ref) && course.sink.ref !== "river_basin") errors.push(course.proposalId + ": dangling confluence"); }

  const reviewEntries = new Map((geographyReview?.decisions ?? []).map((decision) => [decision.proposalId, decision]));
  if (!geographyReview || geographyReview.id !== "pilot-region-geography-review-v2" || !Array.isArray(geographyReview.decisions)) errors.push("geography review v2 is missing");
  for (const decision of geographyReview?.decisions ?? []) { if (![...hydroProposalIds, "elevation.band-hierarchy", "elevation.drainage-constraints"].includes(decision.proposalId)) errors.push("geography review references unknown proposal " + decision.proposalId); if (decision.decision === "accept" && (!decision.acceptedAs?.conceptId || !decision.acceptedAs?.factId || !canonIds.has(decision.acceptedAs.conceptId) || !canonIds.has(decision.acceptedAs.factId))) errors.push("geography review accepted item lacks Canon reference: " + decision.proposalId); }
  for (const accepted of ["hydrography.river-basin", "hydrography.western-waterfall-channel", "hydrography.southern-water-body", "hydrography.northern-mountain-catchment"]) if (reviewEntries.get(accepted)?.decision !== "accept") errors.push("required hydrography decision is not accepted: " + accepted);

  const toponymProposalIds = new Set((toponymy?.proposals ?? []).map((entry) => entry.proposalId));
  if (!toponymReview || toponymReview.id !== "pilot-region-toponym-review-v1" || !Array.isArray(toponymReview.decisions)) errors.push("toponym review v1 is missing");
  const acceptedToponymIds = new Set();
  for (const decision of toponymReview?.decisions ?? []) { if (!toponymProposalIds.has(decision.proposalId)) errors.push("toponym review references unknown proposal " + decision.proposalId); if (decision.decision !== "accept" || !decision.acceptedAs?.conceptId || !decision.acceptedAs?.factId || !canonIds.has(decision.acceptedAs.conceptId) || !canonIds.has(decision.acceptedAs.factId)) errors.push("toponym decision must accept an existing Canon fact: " + decision.proposalId); else acceptedToponymIds.add(decision.proposalId); }
  if (acceptedToponymIds.size !== toponymProposalIds.size) errors.push("every runtime toponym must have an accepted review decision");

  if (!proposal || proposal.status !== "proposed" || proposal.sourceArtifact !== "pilot-region-reference-001") errors.push("proposal must remain status=proposed and reference the artifact manifest");
  const proposalKeys = new Set();
  for (const feature of proposal?.features ?? []) {
    if (!feature.proposalId || proposalKeys.has(feature.proposalId)) errors.push("proposal feature id missing or duplicated: " + (feature.proposalId || "<missing>"));
    if (feature.proposalId) proposalKeys.add(feature.proposalId);
    if (!feature.sourceEvidence) errors.push(feature.proposalId + ": sourceEvidence required");
    if (feature.status && !["proposed","ambiguous"].includes(feature.status)) errors.push(feature.proposalId + ": invalid proposal status");
  }
  for (const hypothesis of proposal?.hypotheses ?? []) {
    if (!hypothesis.id || proposalKeys.has(hypothesis.id)) errors.push("hypothesis id missing or duplicated: " + (hypothesis.id || "<missing>"));
    if (hypothesis.id) proposalKeys.add(hypothesis.id);
    if (hypothesis.notCanonTruth !== true || hypothesis.status !== "proposed") errors.push(hypothesis.id + ": hypotheses must remain proposed and notCanonTruth=true");
    if (typeof hypothesis.confidence !== "number" || hypothesis.confidence < 0 || hypothesis.confidence > 1) errors.push(hypothesis.id + ": confidence must be in [0,1]");
    if (!Array.isArray(hypothesis.categories) || hypothesis.categories.length === 0) errors.push(hypothesis.id + ": categories required");
    if (!Array.isArray(hypothesis.confirmationPaths) || hypothesis.confirmationPaths.length === 0) errors.push(hypothesis.id + ": confirmationPaths required");
    if (!Array.isArray(hypothesis.falsificationPaths) || hypothesis.falsificationPaths.length === 0) errors.push(hypothesis.id + ": falsificationPaths required");
  }
  for (const candidate of proposal?.simulationCandidates ?? []) {
    if (!candidate.id || proposalKeys.has(candidate.id)) errors.push("simulation candidate id missing or duplicated: " + (candidate.id || "<missing>"));
    if (candidate.id) proposalKeys.add(candidate.id);
    if (candidate.status !== "proposed" || candidate.runtimeMapping !== "none") errors.push(candidate.id + ": simulation candidates must not have runtime mapping");
  }

  if (!review || review.proposalId !== "pilot-region-proposal-v1" || !Array.isArray(review.decisions) || review.decisions.length === 0) errors.push("author review must reference the proposal and contain decisions");
  for (const decision of review?.decisions ?? []) {
    if (!proposalKeys.has(decision.proposalId)) errors.push("review references unknown proposal " + decision.proposalId);
    if (!["accept","reject","defer"].includes(decision.decision)) errors.push("review has invalid decision for " + decision.proposalId);
    if (decision.decision === "accept" && (!decision.acceptedAs?.conceptId || !decision.acceptedAs?.factId)) errors.push("accepted review requires conceptId and factId for " + decision.proposalId);
    if (decision.decision === "accept" && (!canonIds.has(decision.acceptedAs?.conceptId) || !canonIds.has(decision.acceptedAs?.factId))) errors.push("accepted review points outside Canon for " + decision.proposalId);
  }
  if (!historicalProposal || historicalProposal.regionId !== "riverwatch-basin" || historicalProposal.status !== "proposed") errors.push("historical layer proposal must remain proposed and reference the pilot region");
  const historicalIds = new Set();
  for (const trace of historicalProposal?.traces ?? []) {
    if (!trace.id || historicalIds.has(trace.id) || !trace.subjectRef || !trace.category || !Array.isArray(trace.evidenceRefs) || trace.evidenceRefs.length === 0 || trace.status !== "proposed") errors.push((trace.id || "<missing>") + ": invalid historical trace proposal");
    if (trace.id) historicalIds.add(trace.id);
  }
  for (const hypothesis of historicalProposal?.hypotheses ?? []) {
    if (!hypothesis.id || historicalIds.has(hypothesis.id) || hypothesis.notCanonTruth !== true || hypothesis.status !== "proposed" || !Array.isArray(hypothesis.confirmationCriteria) || hypothesis.confirmationCriteria.length === 0 || !Array.isArray(hypothesis.falsificationCriteria) || hypothesis.falsificationCriteria.length === 0 || hypothesis.runtimeMapping !== "discovery_question") errors.push((hypothesis.id || "<missing>") + ": invalid historical hypothesis lifecycle");
    if (hypothesis.id) historicalIds.add(hypothesis.id);
  }
  if (!historicalReview || historicalReview.proposalId !== "pilot-region-historical-layer-v1" || !Array.isArray(historicalReview.decisions)) errors.push("historical layer review is missing");
  for (const decision of historicalReview?.decisions ?? []) {
    if (!historicalIds.has(decision.proposalId)) errors.push("historical review references unknown proposal " + decision.proposalId);
    if (!["accept_as_trace", "accept_as_discovery_question", "defer", "reject"].includes(decision.decision)) errors.push("historical review has invalid decision for " + decision.proposalId);
    if (decision.decision === "accept_as_trace" && (!decision.acceptedAs || !canonIds.has(decision.acceptedAs))) errors.push("historical trace decision lacks Canon fact for " + decision.proposalId);
  }
  return { errors, counts: { terrainFeatures: observation?.features?.length ?? 0, coverageCategories: Object.keys(observation?.coverage ?? {}).length, proposals: proposalKeys.size, reviewDecisions: review?.decisions?.length ?? 0 } };
}
if (process.argv[1] && process.argv[1].endsWith("validate-region-authoring.mjs")) {
  const fileIndex = process.argv.indexOf("--file");
  const requestedFile = fileIndex >= 0 ? process.argv[fileIndex + 1] : null;
  if (requestedFile && !existsSync(requestedFile)) { console.error("[region-authoring:validate] error: file not found: " + requestedFile); process.exit(1); }
  const result = validateRegionAuthoring();
  if (result.errors.length) {
    for (const error of result.errors) console.error("[region-authoring:validate] error: " + error);
    console.error("[region-authoring:validate] FAIL (" + result.errors.length + " error(s))");
    process.exit(1);
  }
  console.log("[region-authoring:validate] PASS (" + result.counts.terrainFeatures + " visual features, " + result.counts.coverageCategories + " coverage categories, " + result.counts.proposals + " proposals, " + result.counts.reviewDecisions + " review decisions)");
}
