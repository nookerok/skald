/** Settlement Pattern types (PR-7.4, first long-lived object). */

export type SettlementStatus = "active" | "declining" | "abandoned";

export interface SettlementDefinition {
  readonly settlementId: string;
  readonly name: string;
  readonly locationId: string;
  readonly initialPopulation: number;
  readonly initialRisk: number;
}

export interface SettlementState {
  readonly settlementId: string;
  readonly population: number;
  readonly risk: number;
  readonly status: SettlementStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SettlementReadView {
  readonly settlements: ReadonlyMap<string, SettlementState>;
}
