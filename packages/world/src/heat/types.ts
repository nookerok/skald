/** Heat Transfer system types (PR-7.1). */

export type ThermalZone = "cold" | "neutral" | "warm" | "hot";

export interface HeatProcessDefinition {
  readonly processId: string;
  readonly ambientTemperature: number;
  readonly transferRate: number;
  readonly dissipationRate: number;
  readonly zoneThresholds: {
    readonly cold: number;
    readonly warm: number;
    readonly hot: number;
  };
}

export interface ThermalState {
  readonly zoneId: string;
  readonly temperature: number;
  readonly zone: ThermalZone;
  readonly exposure: number;
  readonly updatedAt: number;
}

export interface HeatReadView {
  readonly heatProcesses: ReadonlyMap<string, HeatProcessDefinition>;
  readonly thermalStates: ReadonlyMap<string, ThermalState>;
}
