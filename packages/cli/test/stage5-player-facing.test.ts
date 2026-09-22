/**
 * Stage 5: the authored situation material is master-only. The player-facing
 * shell DTO strips it, so it can never become a button menu in the browser.
 */

import { describe, expect, it } from "vitest";
import { toPlayerFacingGameShellSnapshot, toPlayerFacingShellDelta } from "../src/http/player-facing.js";

const situation = {
  situationId: "river_waystation_flood",
  title: "Переправа перекрыта водой",
  description: "Вода поднялась.",
  effects: [],
  startedAt: 1,
  remainingTicks: 11,
  masterMaterial: {
    approaches: ["осмотреть следы воды"],
    stakes: "к Речному Стражу не пройти напрямую",
    completion: "понять причину подъёма воды",
  },
};

describe("Stage 5 — player-facing boundary", () => {
  it("strips master material and the situation id from the shell snapshot", () => {
    const dto = toPlayerFacingGameShellSnapshot({
      worldId: "w",
      world: { position: { x: 0, y: 0 }, locationId: "l" },
      currentSituation: situation,
      lastTurn: null,
    } as never) as any;
    expect(dto.currentSituation.situationId).toBeUndefined();
    expect(dto.currentSituation.masterMaterial).toBeUndefined();
    expect(dto.currentSituation.title).toBe("Переправа перекрыта водой");
  });

  it("strips master material from shell deltas", () => {
    const dto = toPlayerFacingShellDelta({ currentSituation: situation, turn: null } as never) as any;
    expect(dto.currentSituation.situationId).toBeUndefined();
    expect(dto.currentSituation.masterMaterial).toBeUndefined();
  });
});
