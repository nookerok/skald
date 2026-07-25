import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";
import { WORLD_WIDTH, WORLD_HEIGHT } from "../map.js";

export const heatSpread: Rule<ReadonlyWorld> = {
  id: "heat.spread",
  phase: "consequence",
  listens: ["TickPassed"],
  produces: ["HeatRadiated"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const now = event.timestamp;
    const out: DomainEvent[] = [];
    let idx = 0;

    for (const source of world.heatSources.values()) {
      const targets = [
        { dx: 0, dy: 0 },
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
      ];

      for (const t of targets) {
        const x = source.x + t.dx;
        const y = source.y + t.dy;
        if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) continue;

        const delta = t.dx === 0 && t.dy === 0 ? source.intensity : source.intensity * 0.5;
        const rounded = Math.round(delta);
        if (rounded === 0) continue;

        out.push({
          eventId: ruleEventId(event.eventId, "HeatRadiated", idx),
          type: "HeatRadiated",
          schemaVersion: 1,
          payload: { x, y, delta: rounded },
          timestamp: now,
          correlationId: event.correlationId,
          causationId: event.eventId,
        });
        idx++;
      }
    }

    return out;
  },
};
