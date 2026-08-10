/**
 * Map Client — HTTP layer for ObserverMapDTO (ADR-0019 §4).
 *
 * Responsible only for fetching the map DTO. No rendering, no state.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Load ObserverMapDTO from the server.
 * @param worldId - The world identifier
 * @param signal - Optional AbortSignal for cancellation
 * @returns Promise resolving to the map DTO
 * @throws on network error, timeout, or invalid DTO
 */
export async function loadObserverMap(worldId, signal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  // Chain external signal if provided
  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }

  try {
    const response = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/map`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Map request failed: ${response.status} ${response.statusText}`);
    }

    const body = await response.json();
    const dto = body?.ok ? body.map : null;

    if (!dto) {
      throw new Error("Invalid map response: missing map");
    }

    // Validate schema version
    if (dto.schemaVersion !== 1 && dto.schemaVersion !== 2) {
      throw new Error(`Unsupported map schema version: ${dto.schemaVersion}`);
    }

    // Validate required fields
    if (!dto.revision || typeof dto.revision.eventNumber !== "number") {
      throw new Error("Invalid map DTO: missing revision");
    }
    if (!Array.isArray(dto.locations) || !Array.isArray(dto.landmarks) || !Array.isArray(dto.routes) || (dto.knownTerrain != null && !Array.isArray(dto.knownTerrain)) || (dto.knownWatercourses != null && !Array.isArray(dto.knownWatercourses)) || (dto.knownWaterBodies != null && !Array.isArray(dto.knownWaterBodies)) || (dto.knownHazards != null && !Array.isArray(dto.knownHazards))) {
      throw new Error("Invalid map DTO: missing locations/landmarks/routes");
    }

    return dto;
  } finally {
    clearTimeout(timeoutId);
  }
}
