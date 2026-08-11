import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseYaml } from "./lib/mini-yaml.mjs";

const KNOWLEDGE = new Set(["unknown", "rumored", "glimpsed", "observed", "traversed"]);
const DETAIL_IDS = new Set(["overview", "central-valley", "blackwood-crater", "northern-pass", "eastern-uplands", "southern-borough"]);

function readYaml(path, errors) {
  try { return parseYaml(readFileSync(path, "utf8"), path); }
  catch (error) { errors.push(path + ": " + error.message); return null; }
}

function readJson(path, errors) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { errors.push(path + ": " + error.message); return null; }
}

function coverageValid(coverage) {
  if (!coverage || typeof coverage !== "object") return false;
  const keys = ["minXMetres", "minYMetres", "maxXMetres", "maxYMetres"];
  if (!keys.every((key) => Number.isFinite(coverage[key]))) return false;
  return coverage.minXMetres <= coverage.maxXMetres && coverage.minYMetres <= coverage.maxYMetres;
}

/** Validate the observer-knowledge authoring contract against compiled Canon. */
export function validateMapKnowledgeMatrix(rootDir = ".", bundle = null) {
  const errors = [];
  const matrixPath = resolve(rootDir, "docs/worldbuilding/riverwatch-map-knowledge-matrix.yaml");
  const bundlePath = resolve(rootDir, "packages/world/src/region/compiled/pilot-region.v5.json");
  const matrix = readYaml(matrixPath, errors);
  const compiled = bundle ?? readJson(bundlePath, errors);

  if (!matrix || matrix.regionId !== "riverwatch-basin" || matrix.imageAuthority !== "presentation_only") {
    errors.push("map knowledge matrix must target riverwatch-basin and mark imageAuthority=presentation_only");
  }

  const region = compiled?.regionDefinition;
  const idsByKind = {
    location: new Set((region?.locations ?? []).map((entry) => entry.id)),
    landmark: new Set((region?.landmarks ?? []).map((entry) => entry.id)),
    relation: new Set((region?.relations ?? []).map((entry) => entry.id)),
    water: new Set([
      ...(region?.hydrography?.watercourses ?? []).map((entry) => entry.id),
      ...(region?.hydrography?.waterBodies ?? []).map((entry) => entry.id),
    ]),
  };
  const allIds = new Set(Object.values(idsByKind).flatMap((ids) => [...ids]));
  const subjects = matrix?.subjects ?? [];
  const subjectById = new Map();
  for (const subject of subjects) {
    if (!subject?.id || subjectById.has(subject.id)) {
      errors.push("matrix subject id missing or duplicated: " + (subject?.id ?? "<missing>"));
      continue;
    }
    subjectById.set(subject.id, subject);
    if (!idsByKind[subject.kind]?.has(subject.id) && !allIds.has(subject.id)) errors.push("matrix subject is not in compiled Canon: " + subject.id);
    if (!KNOWLEDGE.has(subject.initialKnowledge)) errors.push(subject.id + ": invalid initialKnowledge");
    const proposal = typeof subject.runtimeStatus === "string" && /proposal|not.?runtime/i.test(subject.runtimeStatus);
    if (!proposal && (!Array.isArray(subject.discovery) || subject.discovery.length === 0)) errors.push(subject.id + ": runtime subject requires at least one discovery method");
    for (const discovery of subject.discovery ?? []) {
      if (!discovery.method || !KNOWLEDGE.has(discovery.result) || discovery.result === "unknown") errors.push(subject.id + ": invalid discovery result");
    }
    if (subject.exactPositionAt && ["rumored", "glimpsed"].includes(subject.exactPositionAt)) errors.push(subject.id + ": exact position cannot unlock at rumored/glimpsed");
    if (proposal) {
      const observations = (compiled?.events ?? []).filter((event) => event.type === "SpatialObservationRecorded" && event.payload?.subjectId === subject.id);
      if (observations.length > 0) errors.push(subject.id + ": proposal subject must not have bootstrap spatial observations");
    }
  }

  const details = matrix?.details ?? [];
  const detailIds = new Set();
  for (const detail of details) {
    if (!detail?.id || detailIds.has(detail.id)) errors.push("matrix detail id missing or duplicated: " + (detail?.id ?? "<missing>"));
    if (detail?.id) detailIds.add(detail.id);
    if (!DETAIL_IDS.has(detail?.id)) errors.push("matrix detail is not registered: " + (detail?.id ?? "<missing>"));
    if (!coverageValid(detail?.coverage)) errors.push((detail?.id ?? "<missing>") + ": invalid world coverage bounds");
    if (detail?.unlock !== "always") {
      const [subjectId, level] = String(detail?.unlock ?? "").split(".");
      const subject = subjectById.get(subjectId);
      if (!subject || !["glimpsed", "observed", "traversed"].includes(level)) {
        errors.push((detail?.id ?? "<missing>") + ": invalid unlock policy");
      } else {
        const candidates = [
          ...(region?.locations ?? []),
          ...(region?.landmarks ?? []),
        ].filter((entry) => entry.id === subjectId);
        const anchor = candidates[0]?.anchor;
        if (!anchor || anchor.xMetres < detail.coverage.minXMetres || anchor.xMetres > detail.coverage.maxXMetres
          || anchor.yMetres < detail.coverage.minYMetres || anchor.yMetres > detail.coverage.maxYMetres) {
          errors.push((detail?.id ?? "<missing>") + ": unlock subject anchor is outside coverage");
        }
      }
    }
  }
  for (const expected of DETAIL_IDS) if (!detailIds.has(expected)) errors.push("matrix is missing detail asset: " + expected);

  const southernWater = subjectById.get("southern_water_body");
  if (southernWater?.classification !== "unresolved") errors.push("southern water classification must remain unresolved");
  return { errors, counts: { subjects: subjects.length, details: details.length } };
}

if (process.argv[1]?.endsWith("validate-map-knowledge-matrix.mjs")) {
  const result = validateMapKnowledgeMatrix();
  if (result.errors.length) {
    for (const error of result.errors) console.error("[map-matrix:validate] error: " + error);
    console.error("[map-matrix:validate] FAIL (" + result.errors.length + " error(s))");
    process.exit(1);
  }
  console.log("[map-matrix:validate] PASS (" + result.counts.subjects + " subjects, " + result.counts.details + " details)");
}
