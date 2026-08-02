// presence-route.js — pure route decision for the world entry path. Kept
// free of browser globals so it is unit-testable; app.js performs the actual
// navigation implied by the result.

export const ROUTE = {
  PRESENCE: "presence",
  GAME: "game",
  MENU: "menu",
  NEW_GAME: "new-game",
};

/**
 * Decides what the world route must show.
 *
 * - `/world/:id/return` always shows the presence entry.
 * - `/world/:id` shows the game shell only when a browser-session lease
 *   exists; without a lease it resolves to presence (the caller redirects
 *   via location.replace so the shell never renders a frame).
 * - `/new/*` is the new-game flow; everything else is the menu.
 */
export function resolveWorldRoute({ requestedRoute, worldId, hasLease }) {
  if (typeof requestedRoute !== "string") return ROUTE.MENU;
  const worldPath = "/world/" + encodeURIComponent(worldId);
  if (requestedRoute === worldPath + "/return") return ROUTE.PRESENCE;
  if (requestedRoute === worldPath) return hasLease ? ROUTE.GAME : ROUTE.PRESENCE;
  if (requestedRoute.startsWith("/new/")) return ROUTE.NEW_GAME;
  return ROUTE.MENU;
}
