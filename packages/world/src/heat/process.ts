/**
 * Heat Transfer process — deterministic thermal simulation.
 *
 * Implements: energy gradient → heat transfer
 * First system with a fan-out from Weather.
 */

import type { HeatProcessDefinition, ThermalState, ThermalZone } from "./types.js";

/**
 * Classify temperature into a thermal zone.
 */
export function classifyThermalZone(
  temperature: number,
  thresholds: { cold: number; warm: number; hot: number },
): ThermalZone {
  if (temperature < thresholds.cold) return "cold";
  if (temperature < thresholds.warm) return "neutral";
  if (temperature < thresholds.hot) return "warm";
  return "hot";
}

/**
 * Compute heat transfer between zones.
 * Energy gradient drives heat from hot to cold.
 */
export function computeHeatTransfer(
  process: HeatProcessDefinition,
  currentState: ThermalState,
  ambientTemperature: number,
  windFactor: number,
): { temperature: number; zone: ThermalZone; exposure: number } {
  // Heat flows toward ambient temperature
  const gradient = ambientTemperature - currentState.temperature;
  const transfer = gradient * process.transferRate * windFactor;

  // Dissipation reduces exposure over time
  const newExposure = Math.max(0, currentState.exposure - process.dissipationRate);

  // New temperature with clamping
  const newTemperature = Math.round(
    Math.max(-20, Math.min(100, currentState.temperature + transfer)),
  );

  const zone = classifyThermalZone(newTemperature, process.zoneThresholds);

  return {
    temperature: newTemperature,
    zone,
    exposure: newExposure,
  };
}
