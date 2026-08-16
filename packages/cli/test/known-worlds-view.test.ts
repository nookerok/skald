// @ts-nocheck
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PUBLIC = resolve(import.meta.dirname, "../public");

function code(name) {
  return readFileSync(resolve(PUBLIC, name), "utf-8");
}

describe("known-worlds-view.js", () => {
  it("file exists and has expected exports", () => {
    const src = code("known-worlds-view.js");
    expect(src).toContain("export async function loadKnownWorlds");
    expect(src).toContain("export function renderKnownWorlds");
    expect(src).toContain("export async function fillPresenceSummaries");
  });

  it("labels the section Твои истории", () => {
    expect(code("known-worlds-view.js")).toContain("Твои истории");
  });

  it("limits parallel presence fetches to three", () => {
    const src = code("known-worlds-view.js");
    expect(src).toContain("export const PARALLEL_PRESENCE_FETCHES = 3");
    expect(src).toContain("+= PARALLEL_PRESENCE_FETCHES");
  });

  it("skips corrupt worlds when fetching summaries", () => {
    const src = code("known-worlds-view.js");
    expect(src).toContain("cardStateFor(entry.world, null) !== CARD_STATE_CORRUPT");
  });

  it("does not let one failed fetch hide the others", () => {
    const src = code("known-worlds-view.js");
    expect(src).toContain("Promise.all(batch.map(");
    expect(src).toContain("fetchOne(entry)");
  });
});

describe("presence-card-view.js", () => {
  it("file exists and has expected exports", () => {
    const src = code("presence-card-view.js");
    expect(src).toContain("export function renderPresenceCard");
    expect(src).toContain("export function cardStateFor");
  });

  it("has exactly the four required card states", () => {
    const src = code("presence-card-view.js");
    expect(src).toContain('CARD_STATE_LOADING = "loading"');
    expect(src).toContain('CARD_STATE_AVAILABLE = "available"');
    expect(src).toContain('CARD_STATE_UNAVAILABLE = "unavailable"');
    expect(src).toContain('CARD_STATE_CORRUPT = "corrupt"');
  });

  it("maps states to player-facing texts", () => {
    const src = code("presence-card-view.js");
    expect(src).toContain("Загружаем присутствие…");
    expect(src).toContain("Не удалось загрузить присутствие.");
    expect(src).toContain("Сохранение требует восстановления из резервной копии.");
  });

  it("uses the Вернуться button for entering a known world", () => {
    const src = code("presence-card-view.js");
    expect(src).toContain('openBtn.textContent = "Вернуться"');
    expect(src).toContain("skald:return-to-world");
  });

  it("renders only server-provided presence lines, never raw times or ids", () => {
    const src = code("presence-card-view.js");
    expect(src).not.toContain("toLocaleDateString");
    expect(src).not.toContain("worldTime");
    expect(src).not.toContain("eventNumber");
    expect(src).not.toContain("lastPlayedAt");
    expect(src).not.toContain("summary.driftLevel");
  });
});

describe("menu-view.js", () => {
  it("anchors the menu in the authored region", () => {
    expect(code("menu-view.js")).toContain('textContent = "Бассейн Речного Стража"');
  });

  it("renames the new game action to Начать новую историю", () => {
    const src = code("menu-view.js");
    expect(src).toContain('textContent = "Начать новую историю"');
    expect(src).not.toContain('textContent = "Новая игра"');
  });

  it("opens worlds via the /return route", () => {
    const src = code("menu-view.js");
    expect(src).toContain('window.location.hash = "#/world/" + worldId + "/return"');
  });

  it("delegates the world list to known-worlds-view", () => {
    const src = code("menu-view.js");
    expect(src).toContain("import { loadKnownWorlds } from \"./known-worlds-view.js\"");
    expect(src).not.toContain('aria-label="Сохранения"');
    expect(src).not.toContain('textContent = "Открыть"');
    expect(src).not.toContain("world-card-btn");
  });
});

describe("world-api-client.js presence read", () => {
  it("exposes a scoped, world-specific presence summary fetch", () => {
    const src = code("world-api-client.js");
    expect(src).toContain("export async function fetchPresenceSummary(worldId)");
    expect(src).toContain("/presence");
    expect(src).toContain("encodeURIComponent(worldId)");
  });
});
