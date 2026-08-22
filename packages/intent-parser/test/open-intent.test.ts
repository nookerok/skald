import { describe, it, expect } from "vitest";
import {
  parseIntent,
  interpretIntent,
  type ActionIntentCommand,
  type JourneyIntent,
  type InteractionCommand,
} from "@skald/intent-parser";

describe("parseIntent — legacy compatibility", () => {
  it("converts 'move north' to ActionIntentCommand", () => {
    const result = parseIntent("move north");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("relocate");
    expect(cmd.operation).toBe("approach");
    expect(cmd.target?.normalized).toBe("north");
    expect(cmd.interpretation.confidence).toBe(1.0);
  });

  it("converts 'give help to guild' to ActionIntentCommand", () => {
    const result = parseIntent("give help to guild");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("communicate");
    expect(cmd.operation).toBe("speak");
    expect(cmd.target?.raw).toBe("guild");
  });
});

describe("interpretIntent — observe (canonical v1, Slice 1)", () => {
  it.each([
    ["осмотреть дверь", "observe"],
    ["изучить дверь", "inspect"],
    ["рассмотреть дверь", "observe"],
    ["оглядеть дверь", "observe"],
    ["посмотреть на дверь", "observe"],
    ["взглянуть на дверь", "observe"],
    ["проверить дверь", "observe"],
  ])("normalizes '%j' to canonical %s", (input, expectedVerb) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe(expectedVerb);
    expect(cmd.target?.raw).toContain("дверь");
  });
});

describe("interpretIntent — listen (canonical v1, Slice 2)", () => {
  it.each([
    "слушать",
    "прислушаться",
    "прислушаться к звукам",
    "подслушать",
  ])("recognizes listen verb: %j", (input) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("listen");
  });
});

describe("interpretIntent — touch", () => {
  it.each([
    "тронуть камень",
    "прикоснуться к камню",
    "пощупать стену",
    "ладонь к камню",
  ])("recognizes touch verb: %j", (input) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("perceive");
    expect(cmd.operation).toBe("touch");
  });
});

describe("interpretIntent — approach/relocate", () => {
  it.each([
    "подойти к башне",
    "приблизиться к двери",
    "направиться к окну",
    "обойти башню",
  ])("recognizes approach verb: %j", (input) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("relocate");
    expect(cmd.operation).toBe("approach");
  });

  it("recognizes direction from text", () => {
    const result = interpretIntent("идти на север");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("relocate");
    expect(cmd.target?.normalized).toBe("north");
  });
});

describe("interpretIntent — enter", () => {
  it.each([
    "войти в башню",
    "проникнуть внутрь",
    "залезть через окно",
    "лезу через окно",
  ])("recognizes enter verb: %j", (input) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("relocate");
    expect(cmd.operation).toBe("enter");
  });
});

describe("interpretIntent — apply_force", () => {
  it.each([
    "толкнуть дверь",
    "ударить по двери",
    "навалиться на дверь",
    "выбить дверь",
    "сломать замок",
    "пнуть дверь",
    "бросить камень в окно",
  ])("recognizes force verb: %j", (input) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("interact");
    expect(cmd.operation).toBe("apply_force");
  });
});

describe("interpretIntent — heat", () => {
  it.each([
    "нагреть петли",
    "греть петли",
    "поджечь петли",
    "раскалить петли",
    "нагреваю петли",
  ])("recognizes heat verb: %j", (input) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("interact");
    expect(cmd.operation).toBe("heat");
  });

  it("recognizes heat with instrument", () => {
    const result = interpretIntent("нагреть петли с помощью огня");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.operation).toBe("heat");
    expect(cmd.instrument?.raw).toContain("огня");
  });
});

describe("interpretIntent — take (canonical v1)", () => {
  it.each([
    "взять пепел",
    "поднять камень",
    "забрать жаровню",
    "собрать обломки",
  ])("recognizes take verb: %j", (input) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("take");
    expect(cmd.target?.raw).toBeDefined();
  });
});

describe("interpretIntent — create_mark", () => {
  it.each([
    "нарисовать знак на двери",
    "оставить знак пеплом",
    "написать на стене",
    "нацарапать знак",
  ])("recognizes create_mark verb: %j", (input) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("interact");
    expect(cmd.operation).toBe("create_mark");
  });

  it("recognizes mark with instrument", () => {
    const result = interpretIntent("рисую на двери знак найденным пеплом");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.operation).toBe("create_mark");
  });
});

describe("interpretIntent — speak", () => {
  it.each([
    "сказать привет",
    "спросить кто здесь",
    "прошептать тихо",
  ])("recognizes speak verb: %j", (input) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("communicate");
    expect(cmd.operation).toBe("speak");
  });

  it("extracts utterance from colon format", () => {
    const result = interpretIntent("сказать: здесь кто-нибудь есть?");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.operation).toBe("speak");
    expect(cmd.utterance).toBe("здесь кто-нибудь есть?");
  });

  it("extracts utterance from quotes", () => {
    const result = interpretIntent('сказать "привет"');
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.operation).toBe("speak");
    expect(cmd.utterance).toBe("привет");
  });
});

describe("interpretIntent — call", () => {
  it.each([
    "позвать находящегося внутри",
    "крикнуть здесь кто-нибудь",
    "окликнуть",
  ])("recognizes call verb: %j", (input) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("communicate");
    expect(cmd.operation).toBe("call");
  });
});

describe("interpretIntent — wait", () => {
  it.each([
    "ждать",
    "подождать",
    "выждать",
  ])("recognizes wait verb: %j", (input) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("wait");
    expect(cmd.operation).toBe("wait");
  });

  it("recognizes interrupt verb: остановиться", () => {
    const result = interpretIntent("остановиться");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("travel");
    expect(cmd.operation).toBe("interrupt");
  });
});

describe("interpretIntent — goal extraction", () => {
  it("extracts goal with 'чтобы'", () => {
    const result = interpretIntent("нагреть петли чтобы открыть дверь");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.operation).toBe("heat");
    expect(cmd.goal).toBe("открыть дверь");
  });

  it("extracts goal with 'чтоб'", () => {
    const result = interpretIntent("толкнуть дверь чтоб войти");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.goal).toBe("войти");
  });
});

describe("interpretIntent — complex phrases", () => {
  it("handles 'наваливаюсь плечом на дверь'", () => {
    const result = interpretIntent("наваливаюсь плечом на дверь");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.operation).toBe("apply_force");
    expect(cmd.target?.raw).toContain("дверь");
  });

  it("handles 'попробую расплавить петли жаровней'", () => {
    const result = interpretIntent("попробую расплавить петли жаровней");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.operation).toBe("heat");
    expect(cmd.target?.raw).toContain("петли");
  });

  it("handles 'кричу: здесь кто-нибудь есть?'", () => {
    const result = interpretIntent("кричу: здесь кто-нибудь есть?");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.operation).toBe("call");
    expect(cmd.utterance).toBe("здесь кто-нибудь есть?");
  });

  it("handles 'подношу огонь к нижней петле'", () => {
    const result = interpretIntent("подношу огонь к нижней петле");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.operation).toBe("heat");
  });
});

describe("interpretIntent — edge cases", () => {
  it("returns wait for empty input", () => {
    const result = interpretIntent("");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.operation).toBe("wait");
  });

  it("handles question-like input as speak", () => {
    const result = interpretIntent("кто здесь?");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.operation).toBe("speak");
  });

  it("returns unknown for completely unrecognized input", () => {
    const result = interpretIntent("xyzzy plugh");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.operation).toBe("unknown");
  });

  it("preserves rawText", () => {
    const input = "осмотреть дверь";
    const result = interpretIntent(input);
    const cmd = result as InteractionCommand;
    expect(cmd.rawText).toBe(input);
  });

  it("sets source as deterministic", () => {
    const result = interpretIntent("осмотреть дверь");
    const cmd = result as InteractionCommand;
    expect(cmd.interpretation.source).toBe("deterministic");
  });
});

describe("interpretIntent — confidence", () => {
  it("has high confidence when target is present", () => {
    const result = interpretIntent("осмотреть дверь");
    const cmd = result as InteractionCommand;
    expect(cmd.interpretation.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("has lower confidence when target is missing", () => {
    const result = interpretIntent("осмотреть");
    const cmd = result as InteractionCommand;
    expect(cmd.interpretation.confidence).toBeLessThan(0.8);
  });

  it("has high confidence for wait", () => {
    const result = interpretIntent("ждать");
    const cmd = result as ActionIntentCommand;
    expect(cmd.interpretation.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe("interpretIntent — 30+ Russian formulations", () => {
  const formulations: Array<[string, string]> = [
    ["осмотреть дверь", "observe"],
    ["изучить петли", "inspect"],
    ["рассмотреть камень", "observe"],
    ["оглядеть башню", "observe"],
    ["посмотреть на жаровню", "observe"],
    ["взглянуть на окно", "observe"],
    ["проверить замок", "observe"],
    ["слушать звуки", "listen"],
    ["прислушаться", "listen"],
    ["подслушать изнутри", "listen"],
    ["тронуть камень", "touch"],
    ["прикоснуться к стене", "touch"],
    ["пощупать петли", "touch"],
    ["подойти к башне", "approach"],
    ["приблизиться к двери", "approach"],
    ["обойти башню", "approach"],
    ["войти в башню", "enter"],
    ["залезть через окно", "enter"],
    ["проникнуть внутрь", "enter"],
    ["толкнуть дверь", "apply_force"],
    ["ударить по двери", "apply_force"],
    ["навалиться на дверь", "apply_force"],
    ["выбить дверь", "apply_force"],
    ["сломать замок", "apply_force"],
    ["бросить камень в окно", "apply_force"],
    ["нагреть петли", "heat"],
    ["греть петли огнём", "heat"],
    ["поджечь петли", "heat"],
    ["раскалить железо", "heat"],
    ["взять пепел", "take"],
    ["поднять камень", "take"],
    ["забрать жаровню", "take"],
    ["открыть дверь", "open"],
    ["открываю сундук", "open"],
    ["приоткрыть окно", "open"],
    ["распахнуть ворота", "open"],
    ["отдать пепел торговцу", "give"],
    ["передать верёвку незнакомцу", "give"],
    ["нарисовать знак", "create_mark"],
    ["оставить знак пеплом", "create_mark"],
    ["написать на стене", "create_mark"],
    ["сказать привет", "speak"],
    ["спросить кто здесь", "speak"],
    ["прошептать тихо", "speak"],
    ["позвать кого-нибудь", "call"],
    ["крикнуть помощь", "call"],
    ["ждать", "wait"],
    ["подождать", "wait"],
  ];

  it.each(formulations)("interprets '%j' as %s", (input, expectedOp) => {
    const result = interpretIntent(input);
    if (expectedOp === "take" || expectedOp === "open" || expectedOp === "give" ||
        expectedOp === "observe" || expectedOp === "inspect" || expectedOp === "listen") {
      expect(result.type).toBe("InteractionCommand");
      const cmd = result as InteractionCommand;
      expect(cmd.verb).toBe(expectedOp);
    } else {
      expect(result.type).toBe("ActionIntentCommand");
      const cmd = result as ActionIntentCommand;
      expect(cmd.operation).toBe(expectedOp);
    }
  });
});


describe("parseIntent — Interaction Model v1 exact syntax", () => {
  it("parses examine <object> as canonical inspect", () => {
    const result = parseIntent("examine cart");
    expect(result).toEqual({
      type: "InteractionCommand",
      verb: "inspect",
      target: { raw: "cart" },
      rawText: "examine cart",
      interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
    });
  });

  it("parses inspect <object> as canonical inspect", () => {
    const result = parseIntent("inspect door");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("inspect");
    expect(cmd.target?.raw).toBe("door");
  });

  it("keeps a missing target for Command Handler structural rejection", () => {
    const result = parseIntent("examine");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.target).toBeUndefined();
    expect(cmd.interpretation.ambiguities).toEqual(["no clear target identified"]);
  });
});

describe("interpretIntent — Interaction Model v1 (ADR-0013)", () => {
  it("normalizes «взять пепел» to take with a raw target", () => {
    const result = interpretIntent("взять пепел");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("take");
    expect(cmd.target?.raw).toBe("пепел");
    expect(cmd.interpretation.confidence).toBeGreaterThanOrEqual(0.8);
    expect(cmd.interpretation.ambiguities).toEqual([]);
  });

  it("normalizes «поднять верёвку» to take", () => {
    const result = interpretIntent("поднять верёвку");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("take");
    expect(cmd.target?.raw).toBe("веревку");
  });

  it("normalizes «открыть дверь» to open", () => {
    const result = interpretIntent("открыть дверь");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("open");
    expect(cmd.target?.raw).toBe("дверь");
  });

  it("normalizes «попытаться открыть сундук» to open", () => {
    const result = interpretIntent("попытаться открыть сундук");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("open");
    expect(cmd.target?.raw).toBe("сундук");
  });

  it("splits «отдать пепел торговцу» into item and recipient", () => {
    const result = interpretIntent("отдать пепел торговцу");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("give");
    expect(cmd.target?.raw).toBe("пепел");
    expect(cmd.secondaryTarget?.raw).toBe("торговцу");
  });

  it("splits «передать верёвку незнакомцу» into item and recipient", () => {
    const result = interpretIntent("передать верёвку незнакомцу");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("give");
    expect(cmd.target?.raw).toBe("веревку");
    expect(cmd.secondaryTarget?.raw).toBe("незнакомцу");
  });

  it("extracts the instrument for a canonical verb", () => {
    const result = interpretIntent("взять пепел с помощью ветки");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("take");
    expect(cmd.instrument?.raw).toBe("ветки");
  });

  it("handles case, whitespace and ё/е normalization", () => {
    const result = interpretIntent("  ОТКРЫТЬ   дверь  ");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("open");
    expect(cmd.target?.raw).toBe("дверь");
    expect(cmd.rawText).toBe("  ОТКРЫТЬ   дверь  ");

    const yo = interpretIntent("взять ёлку");
    expect(yo.type).toBe("InteractionCommand");
    const yoCmd = yo as InteractionCommand;
    expect(yoCmd.verb).toBe("take");
    expect(yoCmd.target?.raw).toBe("елку");
  });

  it("reports an empty target instead of guessing", () => {
    const result = interpretIntent("взять");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("take");
    expect(cmd.target).toBeUndefined();
    expect(cmd.interpretation.ambiguities).toContain("no clear target identified");
  });

  it("reports give without a recipient", () => {
    const result = interpretIntent("отдать пепел");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("give");
    expect(cmd.secondaryTarget).toBeUndefined();
    expect(cmd.interpretation.ambiguities).toContain("give without a recipient");
  });

  it("rejects a compound intent (one intent per command)", () => {
    const result = interpretIntent("открыть дверь и взять ключ");
    expect(result.type).toBe("ClarificationRequired");
  });

  it("keeps an unknown verb on the legacy unknown path", () => {
    const result = interpretIntent("заколдовать дверь");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.operation).toBe("unknown");
  });

  it("keeps legacy verbs on ActionIntentCommand until their slice", () => {
    const force = interpretIntent("толкнуть дверь");
    expect(force.type).toBe("ActionIntentCommand");
    const touch = interpretIntent("коснуться жаровни");
    expect(touch.type).toBe("ActionIntentCommand");
  });

  it("normalizes «осмотреть дверь» to canonical observe", () => {
    const result = interpretIntent("осмотреть дверь");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("observe");
    expect(cmd.target?.raw).toBe("дверь");
    expect(cmd.interpretation.ambiguities).toEqual([]);
  });

  it("normalizes «осматриваю дверь» to canonical observe", () => {
    const result = interpretIntent("осматриваю дверь");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("observe");
    expect(cmd.target?.raw).toBe("дверь");
  });

  it("keeps observe without a target as an environment intent", () => {
    const result = interpretIntent("осмотреть");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("observe");
    expect(cmd.target).toBeUndefined();
    expect(cmd.interpretation.ambiguities).toContain("no clear target identified");
  });

  it("splits «изучить петли» to canonical inspect (Slice 1 изучить→inspect)", () => {
    const result = interpretIntent("изучить петли");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("inspect");
    expect(cmd.target?.raw).toBe("петли");
  });

  it("normalizes «изучаю петли» to canonical inspect", () => {
    const result = interpretIntent("изучаю петли");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("inspect");
    expect(cmd.target?.raw).toBe("петли");
  });

  it("rejects a compound observe intent", () => {
    const result = interpretIntent("осмотреть дверь и взять пепел");
    expect(result.type).toBe("ClarificationRequired");
  });

  it("normalizes «прислушаться у окна» to canonical listen with a target", () => {
    const result = interpretIntent("прислушаться у окна");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("listen");
    expect(cmd.target?.raw).toBe("окна");
  });

  it("normalizes «слушать звуки» to canonical listen", () => {
    const result = interpretIntent("слушать звуки");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("listen");
    expect(cmd.target).toBeUndefined();
  });

  it("keeps listen without a target as an environment intent", () => {
    const result = interpretIntent("прислушаться");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("listen");
    expect(cmd.target).toBeUndefined();
  });

  it("never checks world existence (no target world knowledge)", () => {
    const result = interpretIntent("взять несуществующийпредмет");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("take");
    expect(cmd.target?.raw).toBe("несуществующийпредмет");
  });
});

describe("interpretIntent — place/use structural parsing (ADR-0032)", () => {
  it("splits «положить камень в сумку» into item and container", () => {
    const result = interpretIntent("положить камень в сумку");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("place");
    expect(cmd.target?.raw).toBe("камень");
    expect(cmd.secondaryTarget?.raw).toBe("сумку");
  });

  it("splits «положить камень внутрь сумки» into item and container", () => {
    const result = interpretIntent("положить камень внутрь сумки");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("place");
    expect(cmd.target?.raw).toBe("камень");
    expect(cmd.secondaryTarget?.raw).toBe("сумки");
  });

  it("keeps place without a container on a plain target", () => {
    const result = interpretIntent("положить камень");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("place");
    expect(cmd.target?.raw).toBe("камень");
    expect(cmd.secondaryTarget).toBeUndefined();
  });

  it("maps «использовать факел чтобы зажечь траву» to instrument + target + canonical goal", () => {
    const result = interpretIntent("использовать факел чтобы зажечь траву");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("use");
    expect(cmd.instrument?.raw).toBe("факел");
    expect(cmd.target?.raw).toBe("траву");
    expect(cmd.goal).toBe("ignite");
  });

  it("maps «применить факел чтобы осветить пещеру» to illuminate", () => {
    const result = interpretIntent("применить факел чтобы осветить пещеру");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("use");
    expect(cmd.instrument?.raw).toBe("факел");
    expect(cmd.target?.raw).toBe("пещеру");
    expect(cmd.goal).toBe("illuminate");
  });

  it("keeps an unmapped use goal raw and lets the world reject honestly", () => {
    const result = interpretIntent("использовать нож чтобы разрезать веревку");
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe("use");
    expect(cmd.instrument?.raw).toBe("нож");
    expect(cmd.goal).toBe("разрезать веревку");
  });
});

describe("interpretIntent — verb token consumed entirely (P0 morphology fix)", () => {
  it.each([
    ["осматриваюсь", "observe"],
    ["я осматриваюсь", "observe"],
    ["медленно осматриваюсь", "observe"],
    ["оглядываюсь", "observe"],
    ["оглянусь вокруг", "observe"],
    ["прислушиваюсь", "listen"],
    ["я внимательно прислушиваюсь", "listen"],
  ])("parses '%j' as %s with NO target from verb remainder", (input, expectedVerb) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe(expectedVerb);
    expect(cmd.target).toBeUndefined();
    expect(cmd.rawText).toBe(input);
  });
});

describe("interpretIntent — verb with explicit target (P0 morphology)", () => {
  it.each([
    ["осматриваю двор", "observe", "двор"],
    ["внимательно осматриваю двор", "observe", "двор"],
    ["смотрю на реку", "observe", "реку"],
    ["посмотрю на старую кладку", "observe", "старую кладку"],
    ["прислушиваюсь к шуму воды", "listen", "шуму воды"],
    ["слушаю перевозчика", "listen", "перевозчика"],
  ])("parses '%j' as %s with target '%s'", (input, expectedVerb, expectedTarget) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("InteractionCommand");
    const cmd = result as InteractionCommand;
    expect(cmd.verb).toBe(expectedVerb);
    expect(cmd.target?.raw).toContain(expectedTarget);
  });
});

describe("interpretIntent — conversational forms (P0)", () => {
  it.each([
    ["осматриваюсь", "observe"],
    ["оглядываюсь", "observe"],
    ["прислушиваюсь", "listen"],
  ])("parses %j without a synthetic target", (input, expectedVerb) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("InteractionCommand");
    const command = result as InteractionCommand;
    expect(command.verb).toBe(expectedVerb);
    expect(command.target).toBeUndefined();
  });

  it("rejects a known stem when it is embedded in a junk word", () => {
    const result = interpretIntent("опосмотреть дверь");
    expect(result.type).toBe("ActionIntentCommand");
    expect((result as ActionIntentCommand).operation).toBe("unknown");
  });
});

describe("interpretIntent — normal words are not stripped (P0 protection)", () => {
  it("preserves inflected observation targets", () => {
    for (const [input, target] of [["посмотреть на карася", "карася"], ["осматриваю ремень", "ремень"]] as const) {
      const result = interpretIntent(input);
      expect(result.type).toBe("InteractionCommand");
      expect((result as InteractionCommand).target?.raw).toBe(target);
    }
  });

  it("preserves a journey destination", () => {
    const result = interpretIntent("иду за лосем");
    expect(result.type).toBe("JourneyIntent");
    expect((result as JourneyIntent).destination.raw).toBe("лосем");
  });

  it("preserves a communication target", () => {
    const result = interpretIntent("говорю им");
    expect(result.type).toBe("ActionIntentCommand");
    expect((result as ActionIntentCommand).operation).toBe("speak");
    expect((result as ActionIntentCommand).utterance).toBe("им");
  });
});

describe("interpretIntent — compound phrases return clarification (P0)", () => {
  it.each([
    "осматриваюсь и иду к реке",
    "слушаю перевозчика, потом перехожу мост",
    "сначала смотрю на воду, затем зову лодочника",
  ])("returns clarification for compound phrase: %j", (input) => {
    const result = interpretIntent(input);
    expect(result.type).toBe("ClarificationRequired");
  });
});
