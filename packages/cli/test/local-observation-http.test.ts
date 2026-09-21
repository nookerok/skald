/**
 * Local scene observation over HTTP (plan: local observation first).
 *
 * "осматриваюсь" at the crossing must surface the location's own objects
 * (ограда, плоскодонка, камни переправы, следы воды) instead of only the
 * static location description, while the wider neighbourhood/routes stay a
 * silent read-side record rather than presentation.
 */

import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBootstrapEvents } from "@skald/world";
import { OPENING_SITUATION_ID } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import type { WorldRuntime } from "../src/runtime/world-runtime-manager.js";

function parse(response: { statusCode: number; body: string }): any {
  if (response.statusCode !== 200) throw new Error(`expected 200 got ${response.statusCode}: ${response.body}`);
  return JSON.parse(response.body);
}

describe("local scene observation at the crossing", () => {
  it("surfaces the location's own objects on an ambient observe", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-local-observe-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    try {
      const worldId = "local-observe";
      store.createWorld({
        worldId,
        idempotencyKey: `create-${worldId}`,
        requestHash: `hash-${worldId}`,
        saveLabel: "Local observation",
        characterName: "Tester",
        characterPresetId: "wanderer",
        worldTemplateId: "living_region",
        characterWound: "none",
        characterPromise: "observe",
        characterPrinciple: "care",
        characterProfileVersion: 1,
        bootstrapEvents: buildBootstrapEvents("living_region"),
      });
      const throwing = { apiKey: "", chat: vi.fn(() => { throw new Error("LLM must not be called"); }) } as any;
      const runtime: WorldRuntime = await new WorldRuntimeManager(store, throwing).get(worldId);

      const response = parse(await handleWorldCommand(runtime, { input: "осматриваюсь", idempotencyKey: "lo-1" }));
      expect(response.ok).toBe(true);

      const presentation = response.presentation ?? {};
      const texts = [
        presentation.primary?.text,
        ...(presentation.notable ?? []).map((entry: { text?: string }) => entry.text),
        response.masterTurn?.deterministicText,
      ].filter((value: unknown): value is string => typeof value === "string").join(" ");

      // At least one authored local detail is surfaced, not just the location line.
      expect(texts).toMatch(/оград|плоскодонк|верхн\w* камн|след\w* воды/iu);

      // The far landmarks' descriptions are not dumped into the presentation
      // (a known route may still be named by the continuation hint).
      expect(texts).not.toContain("Несколько потоков падают с уступа");

      // The opening Situation is simulation-backed now: observing the
      // crossing's water traces raises the watch, and the scene carries it.
      expect(runtime.projection.getSnapshot().activeSituations.has(OPENING_SITUATION_ID)).toBe(true);
      expect(response.shellDelta?.currentSituation ?? null).not.toBeNull();
    } finally {
      store.close();
    }
  });

  it("records a mention for a deterministic action so a pronoun binds (Stage 4)", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "skald-mention-")), "events.sqlite");
    const store = createMultiWorldStore(dbPath);
    try {
      const worldId = "mention-pronoun";
      store.createWorld({
        worldId,
        idempotencyKey: `create-${worldId}`,
        requestHash: `hash-${worldId}`,
        saveLabel: "Mention pronoun",
        characterName: "Tester",
        characterPresetId: "wanderer",
        worldTemplateId: "living_region",
        characterWound: "none",
        characterPromise: "observe",
        characterPrinciple: "care",
        characterProfileVersion: 1,
        bootstrapEvents: buildBootstrapEvents("living_region"),
      });
      const throwing = { apiKey: "", chat: vi.fn(() => { throw new Error("model down"); }) } as any;
      const runtime: WorldRuntime = await new WorldRuntimeManager(store, throwing).get(worldId);

      const first = parse(await handleWorldCommand(runtime, { input: "осматриваю ограду", idempotencyKey: "mp-1" }));
      expect(first.ok).toBe(true);
      const second = parse(await handleWorldCommand(runtime, { input: "осмотрю её внимательнее", idempotencyKey: "mp-2" }));
      expect(second.ok).toBe(true);
      // The mention from the first action binds the pronoun; the turn must not
      // fall back to a missing-referent clarification.
      expect(second.status).not.toBe("clarification");
    } finally {
      store.close();
    }
  });
});
