/**
 * Weather process computation — deterministic cyclic profile.
 *
 * Weather is the first system that influences another (river-hydrology).
 * This is the minimal runtime: just enough to test the influences graph.
 */

import type { WeatherProcessDefinition, WeatherState, SkyCondition, Precipitation, Wind } from "./types.js";

/**
 * Deterministic hash function for pseudo-random weather.
 * Uses simple integer hash, no Math.random().
 */
function hashWorldTime(worldTime: number, seed: number): number {
  let h = (worldTime * 2654435761 + seed * 3266489917) >>> 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b >>> 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b >>> 0;
  h = (h >> 16) ^ h;
  return h;
}

/**
 * Compute weather state at a given worldTime.
 * Cyclic profile: clear → cloudy → overcast → cloudy → clear.
 * Precipitation derived from sky condition.
 * Wind is semi-random based on worldTime hash.
 */
export function computeWeatherState(
  process: WeatherProcessDefinition,
  worldTime: number,
): WeatherState {
  const cyclePos = ((worldTime - process.phaseOffset) % process.seasonCycleTicks + process.seasonCycleTicks) % process.seasonCycleTicks;
  const progress = cyclePos / process.seasonCycleTicks;

  // Sky condition: cyclic
  let skyCondition: SkyCondition;
  if (progress < 0.25) skyCondition = "clear";
  else if (progress < 0.5) skyCondition = "cloudy";
  else if (progress < 0.75) skyCondition = "overcast";
  else skyCondition = "cloudy";

  // Precipitation: derived from sky condition
  let precipitation: Precipitation;
  if (skyCondition === "clear") precipitation = "none";
  else if (skyCondition === "cloudy") precipitation = "none";
  else {
    // overcast: hash-based precipitation
    const h = hashWorldTime(worldTime, 42);
    if (h % 3 === 0) precipitation = "rain";
    else if (h % 3 === 1) precipitation = "snow";
    else precipitation = "fog";
  }

  // Wind: semi-random
  const windHash = hashWorldTime(worldTime, 7);
  let wind: Wind;
  if (windHash % 4 === 0) wind = "strong";
  else if (windHash % 4 === 1) wind = "breeze";
  else wind = "calm";

  // Visibility modifier: derived from precipitation
  let visibilityModifier: number;
  if (precipitation === "none") visibilityModifier = 1.0;
  else if (precipitation === "fog") visibilityModifier = 0.3;
  else if (precipitation === "rain") visibilityModifier = 0.7;
  else visibilityModifier = 0.5; // snow

  return {
    skyCondition,
    precipitation,
    wind,
    visibilityModifier,
    updatedAt: worldTime,
  };
}
