import { describe, expect, it } from "vitest";
import {
  buildRegionDefinition,
  buildRegionResourceDefinitions,
  listCompiledRegionIds,
} from "@skald/world";

describe("compiled region registry", () => {
  it("selects the generated bundle by region id and exposes accepted resources", () => {
    expect(listCompiledRegionIds()).toContain("riverwatch-basin");
    expect(buildRegionDefinition("riverwatch-basin").id).toBe("riverwatch-basin");
    expect(buildRegionResourceDefinitions("riverwatch-basin")).toHaveLength(3);
  });

  it("rejects an unregistered region before bootstrap", () => {
    expect(() => buildRegionDefinition("missing-region")).toThrow(/not registered/);
  });
});
