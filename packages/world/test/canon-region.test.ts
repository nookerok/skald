import { describe, expect, it } from "vitest";

describe("generic Canon region IR", () => {
  it("excludes proposal identifiers and reference artifacts from the runtime bundle", async () => {
    const fs = await import("node:fs");
    const bundle = fs.readFileSync("packages/world/src/region/compiled/pilot-region.v5.json", "utf8");
    expect(bundle).not.toContain("proposalId");
    expect(bundle).not.toContain("candidate.blackwood-timber");
    expect(bundle).not.toContain("hypotheses.monolith-power-source");
    expect(bundle).not.toContain("region-source.png");
  });

  it("is deterministic, version-sensitive and rejects dangling refs", async () => {
    // @ts-expect-error Canon tooling is JavaScript by design.
    const loader = await import("../../../scripts/canon/region/load-region-canon.mjs");
    // @ts-expect-error Canon tooling is JavaScript by design.
    const ir = await import("../../../scripts/canon/region/build-region-ir.mjs");
    // @ts-expect-error Canon tooling is JavaScript by design.
    const digest = await import("../../../scripts/canon/region/digest.mjs");
    const loaded = loader.loadRegionCanon(process.cwd(), "riverwatch-basin");
    const first = ir.buildRegionIR(loaded.projection, loaded.canonIds);
    const reversed = ir.buildRegionIR({ ...loaded.projection, locations: [...loaded.projection.locations].reverse(), relations: [...loaded.projection.relations].reverse(), content: [...loaded.projection.content].reverse() }, loaded.canonIds);
    expect(digest.sha256(first)).toBe(digest.sha256(reversed));
    expect(digest.sha256(first)).not.toBe(digest.sha256(ir.buildRegionIR({ ...loaded.projection, region: { ...loaded.projection.region, version: loaded.projection.region.version + 1 } }, loaded.canonIds)));
    expect(() => ir.buildRegionIR({ ...loaded.projection, content: [{ ...loaded.projection.content[0], canonicalRefs: ["missing.canon.fact"] }] }, loaded.canonIds)).toThrow(/unknown Canon id/);
  });
});
