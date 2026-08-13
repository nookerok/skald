import type { AdventureCheck, AdventureContext, AdventureSnapshot } from "./adventure-types.js";

type Json = Record<string, unknown>;

function nested(snapshot: AdventureSnapshot, key: keyof AdventureSnapshot): Json {
  return (snapshot[key] ?? {}) as Json;
}

function state(snapshot: AdventureSnapshot): Json {
  return nested(snapshot, "state").state as Json ?? {};
}

function map(snapshot: AdventureSnapshot): Json {
  return nested(snapshot, "map").map as Json ?? {};
}

function cards(snapshot: AdventureSnapshot): readonly Json[] {
  const value = nested(snapshot, "discoveries").cards;
  return Array.isArray(value) ? value as Json[] : [];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Json).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function journalComparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(journalComparable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Json).filter(([key]) => key !== "narrationState").map(([key, child]) => [key, journalComparable(child)]));
  }
  return value;
}

function events(ctx: AdventureContext, type?: string): readonly Json[] {
  return type ? ctx.events.filter((event) => event.type === type) : ctx.events;
}

function snapshotLocation(snapshot: AdventureSnapshot): unknown {
  const lastLocation = [...(snapshot.events ?? [])].reverse().find((event) => event.type === "PlayerLocationChanged");
  if (lastLocation) return (lastLocation.payload as Json).locationId;
  const observer = map(snapshot).observer as Json | undefined;
  const ref = observer?.locationRef;
  const location = (Array.isArray(map(snapshot).locations) ? map(snapshot).locations as Json[] : []).find((entry) => entry.ref === ref);
  return location?.name ?? ref;
}

function currentLocation(ctx: AdventureContext): unknown {
  return snapshotLocation(ctx.current);
}

function narrativeValues(value: unknown): string[] {
  const allowed = new Set(["primary", "text", "summary", "title", "question"]);
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(narrativeValues);
  return Object.entries(value as Json).flatMap(([key, child]) => allowed.has(key) ? (typeof child === "string" ? [child] : narrativeValues(child)) : (child && typeof child === "object" ? narrativeValues(child) : []));
}

function hasMasterPresentation(ctx: AdventureContext): boolean {
  return ctx.steps.some((step) => {
    const presentation = step.body.presentation as Json | undefined;
    return Boolean(presentation?.primary || (Array.isArray(presentation?.notable) && presentation.notable.length > 0) || (Array.isArray(presentation?.background) && presentation.background.length > 0));
  });
}

function latestJourney(ctx: AdventureContext): Json | undefined {
  const completed = [...events(ctx, "JourneyCompleted")].at(-1);
  return completed;
}

export function evaluateAdventureCheck(check: AdventureCheck, ctx: AdventureContext): string {
  const currentMap = map(ctx.current);
  const currentState = state(ctx.current);
  const eventTypes = new Set(ctx.events.map((event) => String(event.type)));
  switch (check) {
    case "world_is_living_region":
      return currentMap.region && typeof (currentMap.region as Json).name === "string" ? "" : "map region is missing";
    case "map_has_current_position":
      return currentMap.observer && (currentMap.observer as Json).locationRef ? "" : "observer current position is missing";
    case "conversation_has_master_reply":
      return hasMasterPresentation(ctx) ? "" : "no player-facing master presentation was returned";
    case "rumour_does_not_reveal_coordinates": {
      const locations = Array.isArray(currentMap.locations) ? currentMap.locations as Json[] : [];
      const leaked = locations.some((location) => location.knowledge === "rumored" && (location.xMetres !== null || location.yMetres !== null));
      return leaked ? "rumoured map location contains exact coordinates" : "";
    }
    case "rumour_was_received": {
      const journal = nested(ctx.current, "discoveries");
      const rumors = Array.isArray(journal.rumors) ? journal.rumors as Json[] : [];
      const authored = rumors.find((rumor) => rumor.subjectRef === "old_ruins");
      const payload = events(ctx, "RumorHeard").at(-1)?.payload as Json | undefined;
      return authored?.status === "unverified"
        && authored.source === "social"
        && authored.observerId === "player"
        && Array.isArray(authored.sourceEventIds) && authored.sourceEventIds.length > 0
        && payload?.observerId === "player"
        ? ""
        : "authored rumor lacks observer/evidence provenance";
    }
    case "rumour_is_player_visible": {
      const visible = ctx.steps.some((step) => {
        const presentation = step.body.presentation as Json | undefined;
        const primary = presentation?.primary as Json | undefined;
        return typeof primary?.text === "string" && /старое русло|развалинам на уступе/u.test(primary.text);
      });
      return visible ? "" : "authored rumor never reached the player-facing primary response";
    }
    case "route_alternative_available": {
      const snapshots = [ctx.initial, ...ctx.steps.map((step) => step.snapshot)];
      const available = snapshots.some((snapshot) => {
        const routes = map(snapshot).routes;
        if (!Array.isArray(routes)) return false;
        const groups = new Map<string, Set<string>>();
        for (const route of routes as Json[]) {
          const from = String(route.fromLocationRef ?? "");
          const to = String(route.toLocationRef ?? "");
          const key = `${from}->${to}`;
          const kinds = groups.get(key) ?? new Set<string>();
          kinds.add(String(route.kind ?? ""));
          groups.set(key, kinds);
        }
        return [...groups.values()].some((kinds) => kinds.has("road") && kinds.has("crossing"));
      });
      return available ? "" : "observer map never exposed a road/crossing alternative";
    }
    case "clarification_was_requested":
      return ctx.steps.some((step) => step.body.status === "clarification") ? "" : "no clarification response was recorded";
    case "journey_is_multitick": {
      const started = events(ctx, "JourneyStarted");
      const multiTick = started.some((event) => Number((event.payload as Json).plannedTicks) > 1);
      return multiTick ? "" : "journey did not prove a multi-tick route";
    }
    case "journey_reached_ruins":
      const reachedRuins = events(ctx, "PlayerLocationChanged").some((event) => (event.payload as Json).locationId === "old_ruins");
      return reachedRuins && Boolean(latestJourney(ctx)) ? "" : "player did not reach old ruins";
    case "world_changed_during_journey": {
      const changed = eventTypes.has("WeatherStateChanged") || eventTypes.has("RiverLevelChanged") || eventTypes.has("CrossingConditionChanged");
      return changed ? "" : "no weather, river or crossing change occurred";
    }
    case "conditioned_route_choice": {
      const changedAt = Math.min(...[...events(ctx, "WeatherStateChanged"), ...events(ctx, "RiverLevelChanged"), ...events(ctx, "CrossingConditionChanged")].map((event) => Number(event.timestamp)));
      const choseAfterChange = [...events(ctx, "JourneyRequested"), ...events(ctx, "JourneyStepRequested")].some((event) => Number(event.timestamp) > changedAt);
      return Number.isFinite(changedAt) && choseAfterChange ? "" : "no route choice followed a changed condition";
    }
    case "meaningful_player_choices": {
      const choices = ctx.steps.filter((step) => "choose" in step.step || "answerClarification" in step.step).length;
      return choices >= 3 ? "" : `only ${choices} meaningful player choices were recorded`;
    }
    case "discovery_reached_hypothesis": {
      const found = cards(ctx.current).some((card) => (card.stage === "hypothesis" || card.stage === "discovered") && ["ancient_culture_traces", "conflict_trace", "river_course_shift", "abandoned_infrastructure"].includes(String(card.discoveryId)));
      return found ? "" : "historical discovery did not reach hypothesis stage";
    }
    case "discovery_evidence_loop": {
      const targeted = events(ctx, "ObjectObserved").some((event) => (event.payload as Json).objectId === "old_ruins_masonry");
      const observedTimes = new Set(events(ctx, "SpatialObservationRecorded")
        .filter((event) => (event.payload as Json).subjectId === "old_ruins")
        .map((event) => Number(event.timestamp)));
      return targeted && observedTimes.size >= 2 ? "" : "the ruin trace was not examined through a targeted observation and repeated evidence";
    }
    case "discovery_is_not_canon_truth": {
      const found = cards(ctx.current).some((card) => (card.stage === "hypothesis" || card.stage === "discovered") && card.resolution !== "canon");
      return found ? "" : "discovery was presented as an authoritative truth";
    }
    case "returned_to_waystation":
      const initialRef = (map(ctx.initial).observer as Json | undefined)?.locationRef;
      const currentRef = (currentMap.observer as Json | undefined)?.locationRef;
      return currentRef && currentRef === initialRef ? "" : "player did not return to the waystation";
    case "map_knowledge_grew": {
      const before = Array.isArray(map(ctx.initial).locations) ? (map(ctx.initial).locations as Json[]).length : 0;
      const after = Array.isArray(currentMap.locations) ? (currentMap.locations as Json[]).length : 0;
      const routes = Array.isArray(currentMap.routes) ? currentMap.routes as Json[] : [];
      return after > before && routes.some((route) => route.knowledge === "traversed") ? "" : "observer map did not gain a traversed route and locations";
    }
    case "chronicle_has_adventure_arc": {
      const turns = nested(ctx.current, "journal").turns;
      return Array.isArray(turns) && turns.length >= 10 ? "" : "chronicle is too short for the adventure arc";
    }
    case "offline_world_progressed": {
      const before = state(ctx.offlineStart ?? ctx.initial).worldTime;
      const after = currentState.worldTime;
      return typeof before === "number" && typeof after === "number" && after > before && (events(ctx, "WeatherStateChanged").length + events(ctx, "RiverLevelChanged").length + events(ctx, "SettlementStateChanged").length > 0) ? "" : "offline ticks did not produce autonomous world changes";
    }
    case "offline_did_not_move_player":
      return String(currentLocation(ctx)) === String(snapshotLocation(ctx.offlineStart ?? ctx.initial)) ? "" : "offline ticks changed player location";
    case "offline_has_no_personal_observation_leak": {
      const offlineEvents = (ctx.offlineStart?.events ?? []).length;
      const newEvents = ctx.events.slice(offlineEvents);
      const leaked = newEvents.some((event) => event.type === "SpatialObservationRecorded" && ((event.payload as Json | undefined)?.observerId === "player"));
      return leaked ? "offline ticks created a personal spatial observation" : "";
    }
    case "presence_has_at_most_three_highlights": {
      const presence = nested(ctx.current, "presence").presence as Json | undefined;
      const summary = nested(ctx.current, "presence").summary as Json | undefined;
      const candidates = (summary?.highlights ?? presence?.highlights ?? []) as unknown;
      return Array.isArray(candidates) && candidates.length <= 3 ? "" : "presence has more than three highlights";
    }
    case "restart_preserved_journal": {
      const before = canonical(journalComparable(nested(ctx.restartBefore ?? {}, "journal").turns));
      const after = canonical(journalComparable(nested(ctx.current, "journal").turns));
      return before === after ? "" : "journal changed after restart";
    }
    case "restart_preserved_map":
      return JSON.stringify(map(ctx.current)) === JSON.stringify(map(ctx.restartBefore ?? {})) ? "" : "map changed after restart";
    case "chat_has_no_raw_internal_keys": {
      const journalText = narrativeValues(nested(ctx.current, "journal")).join(" ");
      return /(?:JourneyStarted|PlayerLocationChanged|old_ruins|river_waystation|undefined|eventId|correlationId)/u.test(journalText) ? "player chronicle contains an internal key" : "";
    }
    case "chronicle_is_ordered": {
      const turns = nested(ctx.current, "journal").turns;
      if (!Array.isArray(turns)) return "journal turns are missing";
      const times = turns.map((turn) => Number((turn as Json).worldTime));
      const ascending = times.every((time, index) => index === 0 || time >= times[index - 1]!);
      const descending = times.every((time, index) => index === 0 || time <= times[index - 1]!);
      return ascending || descending ? "" : "journal turns are not ordered";
    }
  }
}

export function evaluateAdventureChecks(checks: readonly AdventureCheck[], ctx: AdventureContext): readonly string[] {
  return checks.map((check) => evaluateAdventureCheck(check, ctx)).filter((message) => message.length > 0);
}
