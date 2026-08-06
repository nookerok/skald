/**
 * Heat Transfer read view projector (PR-7.1).
 *
 * Maintains the HeatReadView exposed to Rules, derived deterministically from
 * canonical HeatProcessDefined / HeatStateChanged events. It is a read-side
 * projection only. The pattern mirrors SpatialProjector.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { HeatProcessDefinition, ThermalState, HeatReadView } from "./types.js";

export class HeatProjector {
  private readonly heatProcesses = new Map<string, HeatProcessDefinition>();
  private readonly thermalStates = new Map<string, ThermalState>();

  apply(event: DomainEvent): void {
    if (event.type === "HeatProcessDefined") {
      const process = event.payload as HeatProcessDefinition;
      this.heatProcesses.set(process.processId, process);
    }
    if (event.type === "HeatStateChanged") {
      const p = event.payload as {
        processId: string;
        temperature: number;
        zone: ThermalState["zone"];
        exposure: number;
        changedAt: number;
      };
      this.thermalStates.set(p.processId, {
        zoneId: p.processId,
        temperature: p.temperature,
        zone: p.zone,
        exposure: p.exposure,
        updatedAt: p.changedAt,
      });
    }
  }

  /** Replace the read view from an existing snapshot (used by WorldProjector.clone). */
  seed(snapshot: HeatReadView | null): void {
    this.heatProcesses.clear();
    this.thermalStates.clear();
    if (!snapshot) return;
    for (const [id, process] of snapshot.heatProcesses) this.heatProcesses.set(id, process);
    for (const [id, state] of snapshot.thermalStates) this.thermalStates.set(id, state);
  }

  getSnapshot(): HeatReadView {
    return Object.freeze({
      heatProcesses: new Map(this.heatProcesses),
      thermalStates: new Map(this.thermalStates),
    });
  }
}
