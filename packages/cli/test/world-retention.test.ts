/**
 * Scratch-world retention planner tests.
 */

import { describe, expect, it } from "vitest";
import { planWorldRetention } from "../src/admin/world-retention.js";
import type { WorldRecord } from "../src/persistence/types.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY;

function world(overrides: Partial<WorldRecord> & { worldId: string }): WorldRecord {
  return {
    saveLabel: overrides.saveLabel ?? "SmokeQA — Бассейн Речного Стража",
    templateId: "living_region",
    entrypointId: "river_waystation_arrival",
    characterId: null,
    characterName: "SmokeQA",
    status: "active",
    createdAt: NOW - 30 * DAY,
    lastPlayedAt: NOW - 30 * DAY,
    worldTime: 5,
    isPrimary: false,
    successorWorldId: null,
    ...overrides,
  };
}

const opts = { now: NOW, ttlMs: 7 * DAY, scratchPattern: /^Smoke/, protectRecent: 1 };

describe("planWorldRetention", () => {
  it("archives an old scratch world", () => {
    const worlds = [
      world({ worldId: "old-scratch", lastPlayedAt: NOW - 30 * DAY }),
      world({ worldId: "newer-scratch", lastPlayedAt: NOW - 1 * DAY }),
    ];
    const plan = planWorldRetention(worlds, opts);
    expect(plan.archive.map((w) => w.worldId)).toEqual(["old-scratch"]);
  });

  it("never archives the primary world, a successor, a fresh or a non-scratch world", () => {
    const worlds = [
      world({ worldId: "primary", isPrimary: true }),
      world({ worldId: "succ", successorWorldId: "next" }),
      world({ worldId: "fresh", lastPlayedAt: NOW - 1 * DAY }), // most-recent → protected
      world({ worldId: "player", saveLabel: "Виктор — Бассейн Речного Стража" }),
      world({ worldId: "archived-scratch", status: "archived" }),
    ];
    const plan = planWorldRetention(worlds, opts);
    expect(plan.archive).toHaveLength(0);
  });

  it("protects the N most-recent active worlds", () => {
    const worlds = [
      world({ worldId: "newest", lastPlayedAt: NOW - 30 * DAY }),
      world({ worldId: "older", lastPlayedAt: NOW - 60 * DAY }),
    ];
    const plan = planWorldRetention(worlds, { ...opts, protectRecent: 1 });
    expect(plan.archive.map((w) => w.worldId)).toEqual(["older"]);
  });
});
