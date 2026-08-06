/**
 * Weather read view projector (ADR-0020, influences graph).
 *
 * Maintains the WeatherReadView exposed to Rules, derived deterministically
 * from canonical WeatherProcessDefined / WeatherStateChanged events. It is a
 * read-side projection only: it never produces events and never decides world
 * outcomes. The pattern mirrors SpatialProjector (region/spatial-projector.ts).
 */

import type { DomainEvent } from "@skald/event-bus";
import type { WeatherProcessDefinition, WeatherState, WeatherReadView } from "./types.js";

export class WeatherProjector {
  private readonly weatherProcesses = new Map<string, WeatherProcessDefinition>();
  private readonly weatherStates = new Map<string, WeatherState>();

  apply(event: DomainEvent): void {
    if (event.type === "WeatherProcessDefined") {
      const process = event.payload as WeatherProcessDefinition;
      this.weatherProcesses.set(process.processId, process);
    }
    if (event.type === "WeatherStateChanged") {
      const p = event.payload as {
        processId: string;
        sky: WeatherState["skyCondition"];
        precipitation: WeatherState["precipitation"];
        wind: WeatherState["wind"];
        visibilityModifier: number;
        changedAt: number;
      };
      this.weatherStates.set(p.processId, {
        skyCondition: p.sky,
        precipitation: p.precipitation,
        wind: p.wind,
        visibilityModifier: p.visibilityModifier,
        updatedAt: p.changedAt,
      });
    }
  }

  /** Replace the read view from an existing snapshot (used by WorldProjector.clone). */
  seed(snapshot: WeatherReadView | null): void {
    this.weatherProcesses.clear();
    this.weatherStates.clear();
    if (!snapshot) return;
    for (const [id, process] of snapshot.weatherProcesses) this.weatherProcesses.set(id, process);
    for (const [id, state] of snapshot.weatherStates) this.weatherStates.set(id, state);
  }

  getSnapshot(): WeatherReadView {
    return Object.freeze({
      weatherProcesses: new Map(this.weatherProcesses),
      weatherStates: new Map(this.weatherStates),
    });
  }
}
