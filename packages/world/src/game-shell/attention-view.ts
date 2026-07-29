import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import type { AttentionLevel, AttentionView } from "./types.js";

export function buildAttentionView(
  world: ReadonlyWorld,
  events: readonly DomainEvent[] = [],
): AttentionView {
  const riskTaken = world.observations.get("risk_taken") ?? 0;
  const marks = Math.max(0, Math.min(5, riskTaken));

  let level: AttentionLevel = "calm";
  if (riskTaken >= 5) level = "pressured";
  else if (riskTaken >= 4) level = "watched";
  else if (riskTaken >= 3) level = "noticed";
  else if (riskTaken >= 1) level = "stirring";

  const explanations: Record<AttentionLevel, string> = {
    calm: "Мир спокоен. Твои действия пока не привлекли внимания.",
    stirring: "Мир начинает замечать твои поступки.",
    noticed: "Ты привлёк внимание мира. Последствия могут проявиться.",
    watched: "Мир следит за тобой. Будь осторожен.",
    pressured: "Мир давит. Каждый шаг имеет цену.",
  };

  const sourceEventIds = events
    .filter(
      (event) =>
        event.type === "ObservationUpdated" &&
        (event.payload as { key?: string }).key === "risk_taken",
    )
    .map((event) => event.eventId);

  return {
    level, marks, maxMarks: 5, explanation: explanations[level], sourceEventIds,
  };
}
