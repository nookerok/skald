import { validateRegionAuthoring } from "./validate-region-authoring.mjs";
const result = validateRegionAuthoring();
if (result.errors.length) {
  for (const error of result.errors) console.error("[visual-canon:validate] error: " + error);
  console.error("[visual-canon:validate] FAIL (" + result.errors.length + " error(s))");
  process.exit(1);
}
console.log("[visual-canon:validate] PASS (" + result.counts.terrainFeatures + " terrain features, " + result.counts.coverageCategories + " coverage categories, " + result.counts.proposals + " proposals, " + result.counts.reviewDecisions + " review decisions)");
