import type { DomainEvent } from "@skald/event-bus";
import { buildDiscoveryJournal, toPlayerDiscoveryJournal } from "@skald/world";
import { isGenericFallbackText } from "@skald/intent-parser";
import { transcriptEntriesForSteps } from "./adventure-transcript.js";
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

function internalDiscoveryCards(ctx: AdventureContext) {
  return buildDiscoveryJournal(ctx.events as unknown as readonly DomainEvent[]).cards;
}

function publicDiscoverySemantics(card: Json): Json {
  return {
    title: card.title,
    question: card.question,
    stage: card.stage,
    summary: card.summary,
    firstSeenAt: card.firstSeenAt,
    lastSeenAt: card.lastSeenAt,
    evidenceCount: card.evidenceCount,
  };
}

function expectedPublicDiscovery(card: ReturnType<typeof buildDiscoveryJournal>["cards"][number]): Json {
  const journal = toPlayerDiscoveryJournal({
    cards: [card],
    recentEvidence: card.evidence,
    rumors: [],
    biographyChains: [],
    worldTime: card.lastSeenAt,
  });
  return publicDiscoverySemantics(journal.cards[0] as unknown as Json);
}

function snapshotLocation(snapshot: AdventureSnapshot): unknown {  const lastLocation = [...(snapshot.events ?? [])].reverse().find((event) => event.type === "PlayerLocationChanged");
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

/** Player-facing character view from the shell snapshot, if present. */
function shellCharacter(ctx: AdventureContext): Json {
  const snapshot = nested(ctx.current, "shell").snapshot as Json | undefined;
  return (snapshot?.character as Json | undefined) ?? {};
}

/** Command text of one adventure step, or null for non-command steps. */
function stepInput(step: AdventureContext["steps"][number]): string | null {
  const raw = step.step;
  if ("say" in raw) return raw.say;
  if ("choose" in raw) return raw.choose;
  if ("answerClarification" in raw) return raw.answerClarification;
  return null;
}

/** Every player-facing master text one step produced (turn, inquiry, presentation). */
function stepMasterTexts(step: AdventureContext["steps"][number]): string[] {
  const texts: string[] = [];
  const turn = step.body.conversationTurn as Json | undefined;
  if (typeof turn?.responseText === "string") texts.push(turn.responseText);
  const inquiry = step.body.inquiry as Json | undefined;
  if (typeof inquiry?.answer === "string") texts.push(inquiry.answer);
  for (const entry of (step.body.inquiries as Json[] | undefined) ?? []) {
    if (typeof entry?.answer === "string") texts.push(entry.answer);
  }
  const presentation = step.body.presentation as Json | undefined;
  const primary = presentation?.primary as Json | undefined;
  if (typeof primary?.text === "string") texts.push(primary.text);
  for (const entry of (presentation?.notable as Json[] | undefined) ?? []) {
    if (typeof entry?.text === "string") texts.push(entry.text);
  }
  for (const entry of (presentation?.background as Json[] | undefined) ?? []) {
    if (typeof entry?.text === "string") texts.push(entry.text);
  }
  if (typeof step.body.question === "string") texts.push(step.body.question);
  return texts.filter((text) => text.trim().length > 0);
}

function norm(text: string): string {
  return text.toLowerCase().replace(/ё/gu, "е");
}

/** The authored old-course rumor event, shared by rumor and knowledge checks. */
function authoredRumor(ctx: AdventureContext): Json | undefined {
  return [...events(ctx, "RumorHeard")].reverse().find((event) => {
    const payload = event.payload as Json;
    return payload.subjectRef === "old_ruins"
      && payload.source === "social"
      && payload.observerId === "player";
  });
}

function stateWorldTime(snapshot: AdventureSnapshot): number | null {
  const time = state(snapshot).worldTime;
  return typeof time === "number" ? time : null;
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
    case "hero_created": {
      const character = shellCharacter(ctx);
      if (character.displayName !== ctx.scenario.characterName) return "shell character does not carry the scenario hero name";
      return typeof character.backgroundTitle === "string" && character.backgroundTitle.trim().length > 0
        ? ""
        : "hero has no background title";
    }
    case "prologue_matches_background": {
      const index = ctx.steps.findIndex((step) => "prologue" in step.step);
      if (index < 0) return "scenario has no prologue step";
      const step = ctx.steps[index]!;
      if (step.statusCode !== 200 || step.body.ok !== true) return "prologue request failed";
      const prologue = step.body.prologue as Json | undefined;
      const firstEntry = step.body.firstEntry as Json | undefined;
      const background = firstEntry?.background as Json | undefined;
      if (typeof prologue?.title !== "string" || !prologue.title.includes(ctx.scenario.characterName)) {
        return "prologue is not addressed to the scenario hero";
      }
      const paragraphs = prologue.paragraphs;
      if (!Array.isArray(paragraphs) || paragraphs.length === 0 || paragraphs.some((p) => typeof p !== "string" || p.trim() === "")) {
        return "prologue has no readable paragraphs";
      }
      const shellTitle = shellCharacter(ctx).backgroundTitle;
      if (typeof background?.title !== "string" || background.title.trim() === "" || background.title !== shellTitle) {
        return "prologue background does not match the created hero background";
      }
      const before = index > 0 ? ctx.steps[index - 1]!.snapshot : ctx.initial;
      const beforeEvents = before.events ?? [];
      const afterEvents = step.snapshot.events ?? [];
      const sameTail = beforeEvents.length === afterEvents.length
        && (beforeEvents.length === 0 || beforeEvents[beforeEvents.length - 1]!.eventId === afterEvents[afterEvents.length - 1]!.eventId);
      return sameTail ? "" : "prologue mutated the Event Log";
    }
    case "free_inquiry_answered": {
      const answered = ctx.steps.some((step) => step.body.status === "inquiry"
        && typeof (step.body.inquiry as Json | undefined)?.answer === "string"
        && ((step.body.inquiry as Json).answer as string).trim().length > 0);
      return answered ? "" : "no free question was answered on the inquiry path";
    }
    case "speech_got_reaction": {
      const spoke = events(ctx, "ActionAttempted").some((event) =>
        (event.payload as Json).operation === "speak" || (event.payload as Json).operation === "call");
      if (!spoke) return "no speak/call attempt reached the world";
      const addressed = ctx.steps.some((step) => {
        const turn = step.body.conversationTurn as Json | undefined;
        return (turn?.responseKind === "action_outcome" || turn?.responseKind === "speech_reaction")
          && typeof turn?.responseText === "string"
          && /обращаешься/u.test(turn.responseText);
      });
      return addressed ? "" : "addressed speech never named its addressee back";
    }
    case "obstacle_named_cause": {
      const blocked = events(ctx, "JourneyBlocked").find((event) => (event.payload as Json).reason === "unknown_destination");
      if (!blocked) return "no unknown-destination obstacle was recorded";
      const cause = (blocked.payload as Json).playerText;
      if (typeof cause !== "string" || cause.trim().length < 20 || !norm(cause).includes("дальнему морю")) {
        return "the obstacle does not name its cause";
      }
      const step = ctx.steps.find((entry) => {
        const input = stepInput(entry);
        return input !== null && norm(input).includes("дальнему морю");
      });
      const turn = step?.body.conversationTurn as Json | undefined;
      return turn?.responseKind === "action_rejection" ? "" : "the obstacle turn is not an action rejection";
    }
    case "knowledge_applied": {
      const rumor = authoredRumor(ctx);
      if (!rumor) return "rumor timestamp is unknown";
      const examined = events(ctx, "ObjectObserved")
        .filter((event) => (event.payload as Json).objectId === "old_ruins_masonry")
        .map((event) => Number(event.timestamp));
      if (!examined.some((at) => at > Number(rumor.timestamp))) {
        return "the targeted masonry examination did not follow the rumor";
      }
      const observedTimes = new Set(events(ctx, "SpatialObservationRecorded")
        .filter((event) => (event.payload as Json).subjectId === "old_ruins")
        .map((event) => Number(event.timestamp)));
      return observedTimes.size >= 2 ? "" : "the examination did not grow into discovery evidence";
    }
    case "no_generic_fallback": {
      const offenders: string[] = [];
      for (const step of ctx.steps) {
        for (const text of stepMasterTexts(step)) {
          if (isGenericFallbackText(text)) offenders.push(`step ${step.index}: ${text.slice(0, 80)}`);
        }
      }
      for (const text of narrativeValues(nested(ctx.current, "journal"))) {
        if (isGenericFallbackText(text)) offenders.push(`journal: ${text.slice(0, 80)}`);
      }
      return offenders.length === 0 ? "" : `generic fallback present: ${offenders.slice(0, 3).join(" | ")}`;
    }
    case "replies_are_linked": {
      const commands = ctx.steps.filter((step) => stepInput(step) !== null);
      if (commands.length === 0) return "scenario has no commands";
      for (const step of commands) {
        const turn = step.body.conversationTurn as Json | undefined;
        if (!turn || typeof turn.playerText !== "string") return `step ${step.index} has no persisted answering turn`;
        if (turn.playerText.trim() !== (stepInput(step) ?? "").trim()) {
          return `step ${step.index} turn echoes a different input`;
        }
      }
      return "";
    }
    case "transcript_covers_every_command": {
      const entries = transcriptEntriesForSteps(ctx.steps);
      for (const step of ctx.steps) {
        const input = stepInput(step);
        if (input === null) continue;
        const player = entries.find((entry) => entry.step === step.index && entry.role === "player");
        if (!player || player.text !== input) return `transcript lost the player replica at step ${step.index}`;
        const master = entries.find((entry) => entry.step === step.index && entry.role === "master");
        if (!master) return `transcript has no master answer at step ${step.index}`;
        if (master.source !== "masterTurn" && master.source !== "conversationTurn" && master.source !== "clarification") {
          return `transcript answer at step ${step.index} is not step-local (source ${master.source ?? "unknown"})`;
        }
        // Correspondence recomputed from the step's own bodies, never from
        // the builder: the master text must start with this step's answer,
        // so another turn's narration can never stand in for it.
        const turn = step.body.conversationTurn as Json | undefined;
        const masterTurn = step.body.masterTurn as Json | undefined;
        const own = step.body.status === "clarification"
          ? (typeof step.body.question === "string" ? step.body.question : null)
          : typeof masterTurn?.deterministicText === "string" && (masterTurn.deterministicText as string).trim()
            ? (masterTurn.deterministicText as string)
            : typeof turn?.responseText === "string" && (turn.responseText as string).trim()
              ? (turn.responseText as string)
              : null;
        if (own !== null && master.text !== own && !master.text.startsWith(`${own}\n`)) {
          return `transcript answer at step ${step.index} does not match its own replica`;
        }
      }
      return "";
    }
    case "memory_survives_restart": {      const restartIndex = ctx.steps.map((step, index) => ("restartServer" in step.step ? index : -1)).filter((i) => i >= 0).at(-1) ?? -1;
      const probe = ctx.steps.find((step) => {
        const input = stepInput(step);
        return input !== null && norm(input).includes("что я знаю об этом месте") && step.index > restartIndex;
      });
      if (!probe || restartIndex < 0) return "post-restart knowledge probe is missing";
      if (probe.body.status !== "inquiry") return "the post-restart probe was not answered on the inquiry path";
      const answer = (probe.body.inquiry as Json | undefined)?.answer;
      // The audacity echo ("дерзость") exists only because pre-restart
      // journeys completed and the consequence fired: a fresh world could
      // never know it. Its presence proves pre-restart knowledge survived
      // the reload through the persisted Event Log and belief read model.
      if (typeof answer !== "string" || !norm(answer).includes("дерзост")) {
        return "post-restart answer lost the pre-restart consequence knowledge";
      }
      return "";
    }
    case "no_stranded_journey": {
      const started = new Map<string, Json>();
      for (const event of events(ctx, "JourneyStarted")) {
        const id = (event.payload as Json).journeyId;
        if (typeof id === "string") started.set(id, event);
      }
      if (started.size === 0) return "no journey ever started";
      const ended = new Set<string>();
      for (const event of [...events(ctx, "JourneyCompleted"), ...events(ctx, "JourneyInterrupted")]) {
        const id = (event.payload as Json).journeyId;
        if (typeof id === "string") ended.add(id);
      }
      const stranded = [...started.keys()].filter((id) => !ended.has(id));
      if (stranded.length > 0) return `stranded journeys: ${stranded.slice(0, 3).join(", ")}`;
      return events(ctx, "JourneyCompleted").length > 0 ? "" : "no journey ever completed";
    }
    case "consequences_persist": {
      const created = events(ctx, "ConsequenceCreated").filter((event) => (event.payload as Json).type === "audacity");
      if (created.length === 0) return "no audacity consequence was ever created";
      const complete = created.some((cause) => {
        const id = (cause.payload as Json).id;
        if (typeof id !== "string") return false;
        const expired = events(ctx, "ConsequenceExpired").some((event) => (event.payload as Json).id === id);
        const fired = events(ctx, "ConsequenceFired").some((event) => (event.payload as Json).consequenceId === id);
        return expired && fired;
      });
      if (!complete) return "no audacity consequence completed its lifecycle";
      return events(ctx, "AudacityTriggered").length > 0 ? "" : "the fired consequence never reached the world";
    }
    case "autonomous_consequence_fired": {
      const offlineStep = ctx.steps.find((step) => "offlineTicks" in step.step);
      if (!offlineStep || !ctx.offlineStart) return "scenario has no offline period";
      const startTime = stateWorldTime(ctx.offlineStart);
      if (startTime === null) return "offline start time is unknown";
      const ticks = (offlineStep.step as { offlineTicks: number }).offlineTicks;
      const windowed = ctx.events.filter((event) => Number(event.timestamp) > startTime && Number(event.timestamp) <= startTime + ticks);
      const lifecycle = windowed.some((event) => event.type === "ConsequenceExpired" || event.type === "ConsequenceFired");
      if (lifecycle) return "";
      const settled = windowed.some((event) => event.type === "SettlementStateChanged");
      return settled ? "" : "nothing autonomous fired while the player was absent";
    }
    case "rumour_does_not_reveal_coordinates": {
      const locations = Array.isArray(currentMap.locations) ? currentMap.locations as Json[] : [];
      const leaked = locations.some((location) => location.knowledge === "rumored" && (location.xMetres !== null || location.yMetres !== null));
      return leaked ? "rumoured map location contains exact coordinates" : "";
    }
    case "rumour_was_received": {
      const journal = nested(ctx.current, "discoveries");
      const rumors = Array.isArray(journal.rumors) ? journal.rumors as Json[] : [];
      const authoredEvent = [...events(ctx, "RumorHeard")].reverse().find((event) => {
        const payload = event.payload as Json;
        return payload.subjectRef === "old_ruins"
          && payload.source === "social"
          && payload.observerId === "player";
      });
      const authored = rumors.find((rumor) => {
        const text = typeof rumor.text === "string" ? rumor.text : "";
        const sourceLabel = typeof rumor.sourceLabel === "string" ? rumor.sourceLabel : "";
        return rumor.status === "unverified"
          && /старое русло|развалинам на уступе/u.test(text)
          && /перевозчик/u.test(sourceLabel)
          && Number(rumor.observedAt) === Number(authoredEvent?.timestamp);
      });
      return authoredEvent && authored
        ? ""
        : "authored rumor is missing from the trusted Event Log or safe player journal";
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
      const historical = internalDiscoveryCards(ctx).filter((card) =>
        (card.stage === "hypothesis" || card.stage === "discovered")
        && ["ancient_culture_traces", "conflict_trace", "river_course_shift", "abandoned_infrastructure"].includes(card.discoveryId),
      );
      const found = historical.some((card) => {
        const expected = expectedPublicDiscovery(card);
        return cards(ctx.current).some((publicCard) =>
          canonical(publicDiscoverySemantics(publicCard)) === canonical(expected),
        );
      });
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
