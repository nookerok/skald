import { describe, expect, it } from "vitest";
import { evaluateAdventureCheck } from "../src/acceptance/adventure-checks.js";
import { handleNewGamePrologue } from "../src/http/catalog-handlers.js";
import type {
  AdventureCheck,
  AdventureContext,
  AdventureScenario,
  AdventureSnapshot,
  AdventureStep,
  AdventureStepResult,
} from "../src/acceptance/adventure-types.js";

type Json = Record<string, unknown>;

function scenario(): AdventureScenario {
  return {
    name: "test-arc",
    worldId: "test-world",
    worldTemplateId: "living_region",
    saveLabel: "test",
    characterName: "Искатель",
    characterPresetId: "wanderer",
    turns: [],
  };
}

function evt(type: string, eventId: string, payload: unknown, timestamp: number): Json {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

function step(index: number, action: AdventureStep, body: Json, snapshot: AdventureSnapshot = {}): AdventureStepResult {
  return { index, step: action, statusCode: 200, body, snapshot, failures: [] };
}

function ctx(over: Partial<AdventureContext> = {}): AdventureContext {
  return {
    scenario: scenario(),
    steps: [],
    current: {},
    initial: {},
    events: [],
    previousClarification: false,
    ...over,
  };
}

function check(check: AdventureCheck, context: AdventureContext): string {
  return (evaluateAdventureCheck as (c: AdventureCheck, x: AdventureContext) => string)(check, context);
}

function shellSnapshot(character: Json): AdventureSnapshot {
  return { shell: { ok: true, snapshot: { character } } };
}

describe("plan_9 §14 hero and prologue checks", () => {  it("hero_created pins the scenario name and a background title", () => {
    const ok = ctx({ current: shellSnapshot({ displayName: "Искатель", backgroundTitle: "Изгнанник" }) });
    expect(check("hero_created", ok)).toBe("");
    const wrongName = ctx({ current: shellSnapshot({ displayName: "Другой", backgroundTitle: "Изгнанник" }) });
    expect(check("hero_created", wrongName)).toContain("hero name");
    const noTitle = ctx({ current: shellSnapshot({ displayName: "Искатель", backgroundTitle: "  " }) });
    expect(check("hero_created", noTitle)).toContain("background title");
  });

  it("prologue_matches_background pins hero, background and read-only behavior", () => {
    const events = [evt("PlayerSpawned", "boot-player", {}, 0)];
    const prologueStep = step(1, { prologue: true }, {
      ok: true,
      prologue: { title: "История Искатель", paragraphs: ["Искатель — северная дорога."] },
      firstEntry: { background: { title: "Изгнанник" } },
    }, { events });
    const good = ctx({
      steps: [prologueStep],
      initial: { events },
      current: shellSnapshot({ displayName: "Искатель", backgroundTitle: "Изгнанник" }),
      events,
    });
    expect(check("prologue_matches_background", good)).toBe("");
    expect(check("prologue_matches_background", ctx())).toContain("no prologue step");
    const wrongTitle = ctx({
      steps: [step(1, { prologue: true }, {
        ok: true,
        prologue: { title: "История Искатель", paragraphs: ["текст"] },
        firstEntry: { background: { title: "Чужой" } },
      }, { events })],
      initial: { events },
      current: shellSnapshot({ displayName: "Искатель", backgroundTitle: "Изгнанник" }),
      events,
    });
    expect(check("prologue_matches_background", wrongTitle)).toContain("does not match");
    const mutating = ctx({
      steps: [step(1, { prologue: true }, {
        ok: true,
        prologue: { title: "История Искатель", paragraphs: ["текст"] },
        firstEntry: { background: { title: "Изгнанник" } },
      }, { events: [...events, evt("TickPassed", "t-1", { delta: 1 }, 1)] })],
      initial: { events },
      current: shellSnapshot({ displayName: "Искатель", backgroundTitle: "Изгнанник" }),
      events,
    });
    expect(check("prologue_matches_background", mutating)).toContain("mutated");
  });
});

describe("plan_9 §14 inquiry, speech and obstacle checks", () => {
  it("free_inquiry_answered requires a non-empty inquiry answer", () => {
    const ok = ctx({ steps: [step(0, { say: "кто рядом" }, { status: "inquiry", inquiry: { answer: "Рядом перевозчик." } })] });
    expect(check("free_inquiry_answered", ok)).toBe("");
    expect(check("free_inquiry_answered", ctx())).toContain("no free question");
  });

  it("speech_got_reaction requires a bound addressee answer", () => {
    const ok = ctx({
      events: [evt("ActionAttempted", "a-1", { mode: "communicate", operation: "speak" }, 3)],
      steps: [step(0, { say: "обратиться к перевозчику" }, {
        conversationTurn: { playerText: "обратиться к перевозчику", responseKind: "action_outcome", responseText: "Ты обращаешься к «Перевозчик у переправы»." },
      })],
    });
    expect(check("speech_got_reaction", ok)).toBe("");
    expect(check("speech_got_reaction", ctx())).toContain("no speak/call attempt");
    const unnamed = ctx({
      events: [evt("ActionAttempted", "a-1", { mode: "communicate", operation: "speak" }, 3)],
      steps: [step(0, { say: "обратиться к перевозчику" }, {
        conversationTurn: { playerText: "обратиться к перевозчику", responseKind: "action_outcome", responseText: "Ты пробуешь изменить ситуацию." },
      })],
    });
    expect(check("speech_got_reaction", unnamed)).toContain("never named");
  });

  it("obstacle_named_cause pins the unknown destination and the rejection", () => {
    const blocked = evt("JourneyBlocked", "jb-1", { reason: "unknown_destination", playerText: "Ты не знаешь дороги к «дальнему морю». Осмотрись." }, 4);
    const ok = ctx({
      events: [blocked],
      steps: [step(0, { say: "идти к Дальнему морю" }, {
        conversationTurn: { playerText: "идти к Дальнему морю", responseKind: "action_rejection", responseText: "Ты не знаешь дороги." },
      })],
    });
    expect(check("obstacle_named_cause", ok)).toBe("");
    expect(check("obstacle_named_cause", ctx())).toContain("no unknown-destination obstacle");
  });

  it("knowledge_applied requires rumor before examination plus evidence", () => {
    const rumor = evt("RumorHeard", "r-1", { subjectRef: "old_ruins", source: "social", observerId: "player" }, 2);
    const exam = evt("ObjectObserved", "o-1", { objectId: "old_ruins_masonry" }, 20);
    const obs = (id: string, t: number): Json => evt("SpatialObservationRecorded", id, { subjectId: "old_ruins" }, t);
    const ok = ctx({ events: [rumor, obs("s-1", 10), obs("s-2", 16), exam] });
    expect(check("knowledge_applied", ok)).toBe("");
    expect(check("knowledge_applied", ctx({ events: [exam, obs("s-1", 10), obs("s-2", 16)] }))).toContain("rumor timestamp is unknown");
    expect(check("knowledge_applied", ctx({ events: [rumor, obs("s-1", 10)] }))).toContain("did not follow the rumor");
    expect(check("knowledge_applied", ctx({ events: [rumor, exam, obs("s-1", 10)] }))).toContain("did not grow");
  });
});

describe("plan_9 §14 transcript integrity checks", () => {
  it("no_generic_fallback scans turns, inquiries and the journal", () => {
    const clean = ctx({
      steps: [step(0, { say: "Иду." }, {
        conversationTurn: { playerText: "Иду.", responseKind: "clarification", responseText: "Куда ты хочешь направиться?" },
      })],
      current: { journal: { turns: [{ primary: { text: "Ты в пути." } }] } },
    });
    expect(check("no_generic_fallback", clean)).toBe("");
    const dirty = ctx({
      steps: [step(0, { say: "сделать что-нибудь" }, {
        conversationTurn: {
          playerText: "сделать что-нибудь",
          responseKind: "clarification",
          responseText: "Я не уверен, что правильно понял действие. Скажи, что ты хочешь сделать в первую очередь.",
        },
      })],
    });
    expect(check("no_generic_fallback", dirty)).toContain("generic fallback present");
  });

  it("replies_are_linked pins one persisted turn echoing each input", () => {
    const ok = ctx({
      steps: [
        step(0, { say: "осмотреться" }, { conversationTurn: { playerText: "осмотреться", responseText: "Двор." } }),
        step(1, { choose: "идти к городу" }, { conversationTurn: { playerText: "идти к городу", responseText: "Путь." } }),
      ],
    });
    expect(check("replies_are_linked", ok)).toBe("");
    const missing = ctx({ steps: [step(0, { say: "осмотреться" }, {})] });
    expect(check("replies_are_linked", missing)).toContain("no persisted answering turn");
    const mismatched = ctx({
      steps: [step(0, { say: "осмотреться" }, { conversationTurn: { playerText: "другое", responseText: "Двор." } })],
    });
    expect(check("replies_are_linked", mismatched)).toContain("echoes a different input");
  });

  it("memory_survives_restart pins post-restart rumor-descendant knowledge", () => {
    const probe = step(5, { say: "что я знаю об этом месте" }, {
      status: "inquiry",
      inquiry: { answer: "Твоя дерзость не осталась без ответа — мир настороже. Переправа." },
    });
    const ok = ctx({ steps: [{ ...step(3, { restartServer: true }, { ok: true }) }, probe] });
    expect(check("memory_survives_restart", ok)).toBe("");
    expect(check("memory_survives_restart", ctx())).toContain("probe is missing");
    const lost = ctx({
      steps: [{ ...step(3, { restartServer: true }, { ok: true }) },
        step(5, { say: "что я знаю об этом месте" }, { status: "inquiry", inquiry: { answer: "Ты знаешь только то, что видишь." } })],
    });
    expect(check("memory_survives_restart", lost)).toContain("lost the pre-restart");
  });
});

describe("plan_9 §14 journey and consequence checks", () => {
  it("no_stranded_journey pairs every start with an end", () => {
    const ok = ctx({
      events: [
        evt("JourneyStarted", "js-1", { journeyId: "j-1" }, 5),
        evt("JourneyCompleted", "jc-1", { journeyId: "j-1" }, 9),
      ],
    });
    expect(check("no_stranded_journey", ok)).toBe("");
    expect(check("no_stranded_journey", ctx())).toContain("no journey ever started");
    const stranded = ctx({ events: [evt("JourneyStarted", "js-1", { journeyId: "j-9" }, 5)] });
    expect(check("no_stranded_journey", stranded)).toContain("stranded journeys: j-9");
  });

  it("consequences_persist requires a completed audacity lifecycle", () => {
    const created = evt("ConsequenceCreated", "cc-1", { id: "audacity@tick-1", type: "audacity" }, 26);
    const expired = evt("ConsequenceExpired", "ce-1", { id: "audacity@tick-1" }, 31);
    const fired = evt("ConsequenceFired", "cf-1", { consequenceId: "audacity@tick-1", consequenceType: "audacity" }, 31);
    const triggered = evt("AudacityTriggered", "at-1", { target: "player", severity: 1 }, 31);
    expect(check("consequences_persist", ctx({ events: [created, expired, fired, triggered] }))).toBe("");
    expect(check("consequences_persist", ctx())).toContain("was ever created");
    expect(check("consequences_persist", ctx({ events: [created] }))).toContain("lifecycle");
    expect(check("consequences_persist", ctx({ events: [created, expired, fired] }))).toContain("never reached");
  });

  it("autonomous_consequence_fired accepts lifecycle or settlement effects offline", () => {
    const offlineStart = { state: { state: { worldTime: 30 } } };
    const offline = step(4, { offlineTicks: 24 }, { ok: true });
    const viaConsequence = ctx({
      steps: [offline],
      offlineStart,
      events: [evt("ConsequenceExpired", "ce-1", { id: "audacity@x" }, 35)],
    });
    expect(check("autonomous_consequence_fired", viaConsequence)).toBe("");
    const viaSettlement = ctx({
      steps: [offline],
      offlineStart,
      events: [evt("SettlementStateChanged", "ss-1", {}, 40)],
    });
    expect(check("autonomous_consequence_fired", viaSettlement)).toBe("");
    const idle = ctx({ steps: [offline], offlineStart, events: [evt("TickPassed", "t-1", { delta: 1 }, 35)] });
    expect(check("autonomous_consequence_fired", idle)).toContain("nothing autonomous fired");
    expect(check("autonomous_consequence_fired", ctx())).toContain("no offline period");
  });
});

describe("plan_9 §14 background shapes the opening", () => {
  function prologue(backgroundId: string): Json {
    const response = handleNewGamePrologue({ characterName: "Искатель", backgroundId, entrypointId: "river_waystation_arrival" });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body) as Json;
  }

  it("writes a different prologue per background", () => {
    const wanderer = prologue("wanderer");
    const keeper = prologue("keeper");
    const echo = prologue("echo");
    const wPara = ((wanderer.prologue as Json).paragraphs as string[]).join(" ");
    const kPara = ((keeper.prologue as Json).paragraphs as string[]).join(" ");
    const ePara = ((echo.prologue as Json).paragraphs as string[]).join(" ");
    expect(wPara).not.toBe(kPara);
    expect(wPara).not.toBe(ePara);
    expect(((wanderer.prologue as Json).title as string)).toContain("Искатель");
    expect(((wanderer.firstEntry as Json).background as Json).title).toBe("Изгнанник с северной дороги");
  });

  it("rejects an unknown background without a world", () => {
    const response = handleNewGamePrologue({ characterName: "Искатель", backgroundId: "nope", entrypointId: "river_waystation_arrival" });
    expect(response.statusCode).toBe(400);
  });
});
