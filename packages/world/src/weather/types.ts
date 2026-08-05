/** Weather system types (ADR-0020, minimal runtime). */

export type SkyCondition = "clear" | "cloudy" | "overcast";
export type Precipitation = "none" | "rain" | "snow" | "fog";
export type Wind = "calm" | "breeze" | "strong";

export interface WeatherProcessDefinition {
  readonly processId: string;
  readonly climateZone: "polar" | "temperate" | "tropical" | "arid";
  readonly seasonCycleTicks: number;
  readonly phaseOffset: number;
}

export interface WeatherState {
  readonly skyCondition: SkyCondition;
  readonly precipitation: Precipitation;
  readonly wind: Wind;
  readonly visibilityModifier: number;
  readonly updatedAt: number;
}

export interface WeatherReadView {
  readonly weatherProcesses: ReadonlyMap<string, WeatherProcessDefinition>;
  readonly weatherStates: ReadonlyMap<string, WeatherState>;
}
