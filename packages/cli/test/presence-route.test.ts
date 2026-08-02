// @ts-nocheck
import { describe, it, expect } from "vitest";
import { resolveWorldRoute, ROUTE } from "../public/presence-route.js";

describe("presence-route.js resolveWorldRoute", () => {
  it("always returns presence for the explicit return path", () => {
    const d = resolveWorldRoute({ requestedRoute: "/world/w1/return", worldId: "w1", hasLease: true });
    expect(d).toBe(ROUTE.PRESENCE);
    const withoutLease = resolveWorldRoute({ requestedRoute: "/world/w1/return", worldId: "w1", hasLease: false });
    expect(withoutLease).toBe(ROUTE.PRESENCE);
  });

  it("allows the game shell only with a browser-session lease", () => {
    const withLease = resolveWorldRoute({ requestedRoute: "/world/w1", worldId: "w1", hasLease: true });
    expect(withLease).toBe(ROUTE.GAME);
    const withoutLease = resolveWorldRoute({ requestedRoute: "/world/w1", worldId: "w1", hasLease: false });
    expect(withoutLease).toBe(ROUTE.PRESENCE);
  });

  it("encodes world ids in the route comparison", () => {
    const d = resolveWorldRoute({ requestedRoute: "/world/" + encodeURIComponent("мир №1"), worldId: "мир №1", hasLease: false });
    expect(d).toBe(ROUTE.PRESENCE);
  });

  it("resolves the new-game flow independently of leases", () => {
    const d = resolveWorldRoute({ requestedRoute: "/new/confirm", worldId: null, hasLease: false });
    expect(d).toBe(ROUTE.NEW_GAME);
  });

  it("falls back to the menu for anything else", () => {
    expect(resolveWorldRoute({ requestedRoute: "/menu", worldId: null, hasLease: false })).toBe(ROUTE.MENU);
    expect(resolveWorldRoute({ requestedRoute: null, worldId: null, hasLease: false })).toBe(ROUTE.MENU);
    expect(resolveWorldRoute({ requestedRoute: "/world/w1/other", worldId: "w1", hasLease: true })).toBe(ROUTE.MENU);
  });
});
