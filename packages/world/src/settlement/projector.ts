/**
 * Settlement Pattern read view projector (PR-7.4, first long-lived object).
 *
 * Maintains the SettlementReadView exposed to Rules, derived deterministically
 * from canonical SettlementCreated / SettlementStateChanged events. It is a
 * read-side projection only. The pattern mirrors SpatialProjector.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { SettlementState, SettlementReadView } from "./types.js";

export class SettlementProjector {
  private readonly settlements = new Map<string, SettlementState>();

  apply(event: DomainEvent): void {
    if (event.type === "SettlementCreated") {
      const state = event.payload as SettlementState;
      this.settlements.set(state.settlementId, state);
    }
    if (event.type === "SettlementStateChanged") {
      const p = event.payload as {
        settlementId: string;
        population: number;
        risk: number;
        status: SettlementState["status"];
        changedAt: number;
      };
      const existing = this.settlements.get(p.settlementId);
      this.settlements.set(p.settlementId, {
        settlementId: p.settlementId,
        population: p.population,
        risk: p.risk,
        status: p.status,
        createdAt: existing?.createdAt ?? p.changedAt,
        updatedAt: p.changedAt,
      });
    }
  }

  /** Replace the read view from an existing snapshot (used by WorldProjector.clone). */
  seed(snapshot: SettlementReadView | null): void {
    this.settlements.clear();
    if (!snapshot) return;
    for (const [id, state] of snapshot.settlements) this.settlements.set(id, state);
  }

  getSnapshot(): SettlementReadView {
    return Object.freeze({
      settlements: new Map(this.settlements),
    });
  }
}
