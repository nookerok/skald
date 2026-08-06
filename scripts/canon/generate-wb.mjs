// canon:generate-wb — generates the human-readable World Bible projection
// docs/WORLD_BIBLE.md from the Canon Model (ADR-0021 decision 5).
// The output is a derived projection (A-3): it contains nothing that is not
// in docs/canon/, it is never hand-edited and it is git-ignored.
// Deterministic: same Canon Model input produces byte-identical output.
// Refuses to write when the Canon Model fails validation (validateCanon), so a
// partially-parsed or semantically broken Canon can never leak into the Bible.

import { writeFileSync } from "node:fs";
import { validateCanon } from "./validate.mjs";

const OUTPUT = "docs/WORLD_BIBLE.md";

const { documents, errors, warnings } = validateCanon();
for (const warning of warnings) console.warn(`[canon:generate-wb] warning: ${warning}`);
if (errors.length > 0) {
  for (const error of errors) console.error(`[canon:generate-wb] error: ${error}`);
  console.error(`[canon:generate-wb] FAIL: refusing to generate a World Bible from an invalid Canon Model (${errors.length} error(s))`);
  process.exit(1);
}

const concepts = [];
const anchors = [];
const claims = [];
const tools = [];
for (const doc of documents) {
  if (doc.kind === "concept") concepts.push({ ...doc.data.concept, file: doc.file });
  if (doc.kind === "anchors") anchors.push(...doc.data.anchors);
  if (doc.kind === "claims") claims.push(...doc.data.claims);
  if (doc.kind === "tools") tools.push(...doc.data.tools);
}
concepts.sort((a, b) => a.id.localeCompare(b.id));

const lines = [];
const push = (line = "") => lines.push(line);

push("# SKALD World Bible");
push();
push("> GENERATED PROJECTION of the Canon Model. Do not edit by hand.");
push("> Source of truth: `docs/canon/`. Regenerate: `npm run canon:generate-wb`.");
push("> Architecture: `docs/WORLD_BIBLE_ARCHITECTURE.md` (ADR-0021).");
push();
push("---");
push();
push("## Canon Index");
push();
push("| Concept | Scope | Domain | Temporal | Lifecycle | Depth | Facts |");
push("|---|---|---|---|---|---|---|");
for (const concept of concepts) {
  const temporal = `${concept.temporalScope?.scale ?? "?"}/${concept.temporalScope?.mutation ?? "?"}`;
  push(`| ${concept.id} | ${concept.scope} | ${concept.domain} | ${temporal} | ${concept.lifecycle} | ${concept.simulationDepth} | ${(concept.facts ?? []).length} |`);
}
push();

const scopes = [...new Set(concepts.map((c) => c.scope))].sort();
for (const scope of scopes) {
  push(`## ${scope} Canon`);
  push();
  const domains = [...new Set(concepts.filter((c) => c.scope === scope).map((c) => c.domain))].sort();
  for (const domain of domains) {
    push(`### ${domain}`);
    push();
    for (const concept of concepts.filter((c) => c.scope === scope && c.domain === domain)) {
      push(`#### ${concept.id}`);
      push();
      push(`- Lifecycle: ${concept.lifecycle}; Simulation Depth: ${concept.simulationDepth}`);
      push(`- Temporal: ${concept.temporalScope?.scale}/${concept.temporalScope?.mutation}`);
      push(`- Provenance: proposed by ${concept.provenance?.proposedBy}; accepted by ${concept.provenance?.acceptedBy}`);
      if ((concept.relations ?? []).length > 0) {
        push(`- Relations: ${concept.relations.map((r) => `${r.type} -> ${r.target}`).join("; ")}`);
      }
      push();
      if ((concept.facts ?? []).length > 0) {
        push("| Fact | Type | Observability | Cost | Consequences |");
        push("|---|---|---|---|---|");
        for (const fact of concept.facts) {
          push(`| ${fact.statement} | ${fact.type} | ${fact.observability ?? "-"} | ${fact.knowledgeCost ?? "-"} | ${(fact.consequences ?? []).length} |`);
        }
        push();
      }
      if (concept.runtimeMapping && Object.keys(concept.runtimeMapping).length > 0) {
        push("Runtime Mapping:");
        push();
        for (const [channel, entries] of Object.entries(concept.runtimeMapping)) {
          if (Array.isArray(entries) && entries.length > 0) {
            push(`- ${channel}: ${entries.join("; ")}`);
          }
        }
        push();
      }
      if (concept.plannedRuntime) {
        push(`Planned runtime: ${concept.plannedRuntime}`);
        push();
      }
    }
  }
}

push("## Canonical Anchors");
push();
push("| Anchor | Concept | Region | Obligation |");
push("|---|---|---|---|");
for (const anchor of anchors) {
  push(`| ${anchor.id} | ${anchor.conceptId} | ${anchor.regionId} | ${anchor.obligation} |`);
}
push();

push("## Not Simulated");
push();
push("| Claim | Category | Reason | Review after |");
push("|---|---|---|---|");
for (const claim of claims) {
  push(`| ${claim.statement} | ${claim.category} | ${claim.reason} | ${claim.reviewAfter ?? "-"} |`);
}
push();

push("## Deferred Tooling (Not Built registry)");
push();
push("| Tool | Status | Reason | Triggers |");
push("|---|---|---|---|");
for (const tool of tools) {
  const triggers = Array.isArray(tool.trigger) ? tool.trigger.join("; ") : (tool.trigger ?? "-");
  push(`| ${tool.tool} | ${tool.status} | ${tool.reason ?? "-"} | ${triggers} |`);
}
push();

writeFileSync(OUTPUT, lines.join("\n"), "utf8");
console.log(`[canon:generate-wb] wrote ${OUTPUT} (${concepts.length} concepts, ${anchors.length} anchors, ${claims.length} claims, ${tools.length} deferred tools)`);
