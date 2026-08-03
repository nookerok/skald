/**
 * Map Layout — coordinate projection for Player Map (ADR-0019 §4).
 *
 * Converts DTO coordinates to viewport coordinates.
 * Pure functions only, no DOM manipulation.
 */

/**
 * Project a point from DTO coordinates to viewport coordinates.
 * Preserves aspect ratio, adds padding.
 *
 * @param {number} xMetres - X in metres (DTO space)
 * @param {number} yMetres - Y in metres (DTO space)
 * @param {{ minXMetres: number; minYMetres: number; maxXMetres: number; maxYMetres: number }} knownArea - Bounding box
 * @param {{ width: number; height: number }} viewport - Viewport dimensions
 * @param {{ padding?: number }} options - Optional padding
 * @returns {{ x: number; y: number } | null}
 */
export function projectPoint(xMetres, yMetres, knownArea, viewport, options) {
  if (!knownArea || viewport.width <= 0 || viewport.height <= 0) return null;
  if (typeof xMetres !== "number" || typeof yMetres !== "number") return null;

  const padding = options?.padding ?? 20;
  const usableWidth = viewport.width - padding * 2;
  const usableHeight = viewport.height - padding * 2;

  if (usableWidth <= 0 || usableHeight <= 0) return null;

  const areaWidth = knownArea.maxXMetres - knownArea.minXMetres;
  const areaHeight = knownArea.maxYMetres - knownArea.minYMetres;

  if (areaWidth <= 0 || areaHeight <= 0) {
    // Single point: center in viewport
    return { x: viewport.width / 2, y: viewport.height / 2 };
  }

  // Scale to fit while preserving aspect ratio
  const scaleX = usableWidth / areaWidth;
  const scaleY = usableHeight / areaHeight;
  const scale = Math.min(scaleX, scaleY);

  // Center the map
  const scaledWidth = areaWidth * scale;
  const scaledHeight = areaHeight * scale;
  const offsetX = padding + (usableWidth - scaledWidth) / 2;
  const offsetY = padding + (usableHeight - scaledHeight) / 2;

  return {
    x: offsetX + (xMetres - knownArea.minXMetres) * scale,
    y: offsetY + (yMetres - knownArea.minYMetres) * scale,
  };
}

/**
 * Compute bounding box for a set of map items.
 */
export function computeBounds(items) {
  if (!items || items.length === 0) return null;

  const xs = [];
  const ys = [];

  for (const item of items) {
    if (item.xMetres != null) xs.push(item.xMetres);
    if (item.yMetres != null) ys.push(item.yMetres);
  }

  if (xs.length === 0 || ys.length === 0) return null;

  return {
    minXMetres: Math.min(...xs),
    minYMetres: Math.min(...ys),
    maxXMetres: Math.max(...xs),
    maxYMetres: Math.max(...ys),
  };
}
