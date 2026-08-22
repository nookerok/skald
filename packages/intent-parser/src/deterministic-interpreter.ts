/**
 * Deterministic Russian interpreter for player intent.
 *
 * Maps natural Russian text to a finite set of IntentOperations.
 * No world access, no gameplay decisions, no randomness.
 */

import type {
  IntentMode,
  IntentOperation,
  IntentReference,
  IntentResult,
  ClarificationRequest,
  InteractionCommand,
  InteractionVerb,
  TargetRequirement,
  UnsupportedIntent,
} from "./types.js";

interface VerbEntry {
  readonly verb: string;
  readonly mode: IntentMode;
  readonly operation: IntentOperation;
  /**
   * Set for verbs routed through the canonical Interaction Model v1 pipeline
   * (ADR-0013). Verbs without a canonical value keep the legacy
   * ActionIntentCommand path and migrate per vertical slice.
   */
  readonly canonical?: InteractionVerb | undefined;
  /** Whether this verb requires, allows, or forbids a direct object. */
  readonly target: TargetRequirement;
  /** Prepositions that introduce the target (e.g., "на" for "посмотреть на"). */
  readonly targetPrepositions?: readonly string[];
}

const VERBS: readonly VerbEntry[] = [
  // observe (canonical v1, Slice 1 — ADR-0013 §2)
  { verb: "осмотреть", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "осматрива", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "рассмотреть", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "оглядеть", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "оглянуть", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "посмотреть", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "взглянуть", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "проверить", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "осмотр", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "рассматрив", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "посмотр", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "взгляд", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "оглядыва", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "оглянусь", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "оглян", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  { verb: "смотр", mode: "perceive", operation: "observe", canonical: "observe", target: "optional", targetPrepositions: ["на", "в", "вокруг"] },
  // inspect (canonical v1, Slice 1)
  { verb: "изучить", mode: "perceive", operation: "observe", canonical: "inspect", target: "optional" },
  { verb: "изуч", mode: "perceive", operation: "observe", canonical: "inspect", target: "optional" },
  { verb: "роздать", mode: "perceive", operation: "observe", target: "optional" },
  // listen (canonical v1, Slice 2 — ADR-0013 §2)
  { verb: "слушать", mode: "perceive", operation: "listen", canonical: "listen", target: "optional", targetPrepositions: ["к"] },
  { verb: "прислушаться", mode: "perceive", operation: "listen", canonical: "listen", target: "optional", targetPrepositions: ["к"] },
  { verb: "прислушать", mode: "perceive", operation: "listen", canonical: "listen", target: "optional", targetPrepositions: ["к"] },
  { verb: "подслушать", mode: "perceive", operation: "listen", canonical: "listen", target: "optional", targetPrepositions: ["к"] },
  { verb: "вслушаться", mode: "perceive", operation: "listen", canonical: "listen", target: "optional", targetPrepositions: ["к"] },
  { verb: "вслушать", mode: "perceive", operation: "listen", canonical: "listen", target: "optional", targetPrepositions: ["к"] },
  { verb: "прислушива", mode: "perceive", operation: "listen", canonical: "listen", target: "optional", targetPrepositions: ["к"] },
  { verb: "слуш", mode: "perceive", operation: "listen", canonical: "listen", target: "optional", targetPrepositions: ["к"] },
  // touch
  { verb: "тронуть", mode: "perceive", operation: "touch", target: "required" },
  { verb: "трогать", mode: "perceive", operation: "touch", target: "required" },
  { verb: "прикоснуться", mode: "perceive", operation: "touch", target: "required" },
  { verb: "прикоснуть", mode: "perceive", operation: "touch", target: "required" },
  { verb: "пощупать", mode: "perceive", operation: "touch", target: "required" },
  { verb: "пощупа", mode: "perceive", operation: "touch", target: "required" },
  { verb: "ладонь", mode: "perceive", operation: "touch", target: "required" },
  { verb: "рукой", mode: "perceive", operation: "touch", target: "required" },
  { verb: "потрогать", mode: "perceive", operation: "touch", target: "required" },
  // approach / relocate
  { verb: "подойти", mode: "relocate", operation: "approach", target: "required" },
  { verb: "приблизиться", mode: "relocate", operation: "approach", target: "required" },
  { verb: "приблизить", mode: "relocate", operation: "approach", target: "required" },
  { verb: "направиться", mode: "relocate", operation: "approach", target: "required" },
  { verb: "подобраться", mode: "relocate", operation: "approach", target: "required" },
  { verb: "подобрать", mode: "relocate", operation: "approach", target: "required" },
  { verb: "обойти", mode: "relocate", operation: "approach", target: "required" },
  { verb: "обхожу", mode: "relocate", operation: "approach", target: "required" },
  { verb: "подход", mode: "relocate", operation: "approach", target: "required" },
  // enter
  { verb: "войти", mode: "relocate", operation: "enter", target: "optional" },
  { verb: "входить", mode: "relocate", operation: "enter", target: "optional" },
  { verb: "проникнуть", mode: "relocate", operation: "enter", target: "optional" },
  { verb: "проникать", mode: "relocate", operation: "enter", target: "optional" },
  { verb: "залезть", mode: "relocate", operation: "enter", target: "optional" },
  { verb: "влезть", mode: "relocate", operation: "enter", target: "optional" },
  { verb: "пролезть", mode: "relocate", operation: "enter", target: "optional" },
  { verb: "попасть", mode: "relocate", operation: "enter", target: "optional" },
  { verb: "лезу", mode: "relocate", operation: "enter", target: "optional" },
  { verb: "влеза", mode: "relocate", operation: "enter", target: "optional" },
  { verb: "забира", mode: "relocate", operation: "enter", target: "optional" },
  // apply_force
  { verb: "толкнуть", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "толкать", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "ударить", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "ударять", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "навалиться", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "наваливать", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "наваливаю", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "наваливаешь", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "наваливает", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "наваливаем", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "наваливаете", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "выбить", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "сломать", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "вдавить", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "пнуть", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "бросить", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "броса", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "пина", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "вбить", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "вбива", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "вырвать", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "вырыва", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "отодвинуть", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "поддеть", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "поддева", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "тяну", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "дёрнуть", mode: "interact", operation: "apply_force", target: "required" },
  { verb: "дёрга", mode: "interact", operation: "apply_force", target: "required" },
  // heat
  { verb: "нагреть", mode: "interact", operation: "heat", target: "required" },
  { verb: "греть", mode: "interact", operation: "heat", target: "required" },
  { verb: "поджечь", mode: "interact", operation: "heat", target: "required" },
  { verb: "поджиг", mode: "interact", operation: "heat", target: "required" },
  { verb: "поднести огонь", mode: "interact", operation: "heat", target: "required" },
  { verb: "оплавить", mode: "interact", operation: "heat", target: "required" },
  { verb: "расплавить", mode: "interact", operation: "heat", target: "required" },
  { verb: "расплавл", mode: "interact", operation: "heat", target: "required" },
  { verb: "раскалить", mode: "interact", operation: "heat", target: "required" },
  { verb: "нагрева", mode: "interact", operation: "heat", target: "required" },
  { verb: "грею", mode: "interact", operation: "heat", target: "required" },
  { verb: "греешь", mode: "interact", operation: "heat", target: "required" },
  { verb: "греет", mode: "interact", operation: "heat", target: "required" },
  { verb: "греем", mode: "interact", operation: "heat", target: "required" },
  { verb: "греете", mode: "interact", operation: "heat", target: "required" },
  { verb: "греете", mode: "interact", operation: "heat", target: "required" },
  { verb: "подношу огонь", mode: "interact", operation: "heat", target: "required" },
  { verb: "подношу огонь", mode: "interact", operation: "heat", target: "required" },
  { verb: "поднес", mode: "interact", operation: "heat", target: "required" },
  // cool
  { verb: "остудить", mode: "interact", operation: "cool", target: "required" },
  { verb: "охладить", mode: "interact", operation: "cool", target: "required" },
  { verb: "залить", mode: "interact", operation: "cool", target: "required" },
  { verb: "накрыть", mode: "interact", operation: "cool", target: "required" },
  // take (canonical v1)
  { verb: "взять", mode: "interact", operation: "take", canonical: "take", target: "required" },
  { verb: "поднять", mode: "interact", operation: "take", canonical: "take", target: "required" },
  { verb: "забрать", mode: "interact", operation: "take", canonical: "take", target: "required" },
  { verb: "достать", mode: "interact", operation: "take", canonical: "take", target: "required" },
  { verb: "собрать", mode: "interact", operation: "take", canonical: "take", target: "required" },
  { verb: "взял", mode: "interact", operation: "take", canonical: "take", target: "required" },
  { verb: "беру", mode: "interact", operation: "take", canonical: "take", target: "required" },
  { verb: "берешь", mode: "interact", operation: "take", canonical: "take", target: "required" },
  { verb: "берет", mode: "interact", operation: "take", canonical: "take", target: "required" },
  { verb: "берем", mode: "interact", operation: "take", canonical: "take", target: "required" },
  { verb: "берете", mode: "interact", operation: "take", canonical: "take", target: "required" },
  { verb: "собира", mode: "interact", operation: "take", canonical: "take", target: "required" },
  // open (canonical v1)
  { verb: "открыть", mode: "interact", operation: "open", canonical: "open", target: "required" },
  { verb: "открыва", mode: "interact", operation: "open", canonical: "open", target: "required" },
  { verb: "открою", mode: "interact", operation: "open", canonical: "open", target: "required" },
  { verb: "открой", mode: "interact", operation: "open", canonical: "open", target: "required" },
  { verb: "открыл", mode: "interact", operation: "open", canonical: "open", target: "required" },
  { verb: "приоткрыть", mode: "interact", operation: "open", canonical: "open", target: "required" },
  { verb: "приоткрыва", mode: "interact", operation: "open", canonical: "open", target: "required" },
  { verb: "распахнуть", mode: "interact", operation: "open", canonical: "open", target: "required" },
  { verb: "распахива", mode: "interact", operation: "open", canonical: "open", target: "required" },
  { verb: "раскрыть", mode: "interact", operation: "open", canonical: "open", target: "required" },
  { verb: "раскрыва", mode: "interact", operation: "open", canonical: "open", target: "required" },
  // close (canonical v1)
  { verb: "закрыть", mode: "interact", operation: "close", canonical: "close", target: "required" },
  { verb: "закрыва", mode: "interact", operation: "close", canonical: "close", target: "required" },
  { verb: "закрой", mode: "interact", operation: "close", canonical: "close", target: "required" },
  { verb: "закрыл", mode: "interact", operation: "close", canonical: "close", target: "required" },
  // give (canonical v1)
  { verb: "отдать", mode: "interact", operation: "give", canonical: "give", target: "required" },
  { verb: "отдам", mode: "interact", operation: "give", canonical: "give", target: "required" },
  { verb: "отдай", mode: "interact", operation: "give", canonical: "give", target: "required" },
  { verb: "отдаю", mode: "interact", operation: "give", canonical: "give", target: "required" },
  { verb: "отдава", mode: "interact", operation: "give", canonical: "give", target: "required" },
  { verb: "отдает", mode: "interact", operation: "give", canonical: "give", target: "required" },
  { verb: "отдаешь", mode: "interact", operation: "give", canonical: "give", target: "required" },
  { verb: "передать", mode: "interact", operation: "give", canonical: "give", target: "required" },
  { verb: "передам", mode: "interact", operation: "give", canonical: "give", target: "required" },
  { verb: "передай", mode: "interact", operation: "give", canonical: "give", target: "required" },
  { verb: "передаю", mode: "interact", operation: "give", canonical: "give", target: "required" },
  { verb: "передава", mode: "interact", operation: "give", canonical: "give", target: "required" },
  { verb: "передает", mode: "interact", operation: "give", canonical: "give", target: "required" },
  { verb: "вручить", mode: "interact", operation: "give", canonical: "give", target: "required" },
  { verb: "вруча", mode: "interact", operation: "give", canonical: "give", target: "required" },
  // place (canonical v1)
  { verb: "положить", mode: "interact", operation: "place", canonical: "place", target: "required" },
  { verb: "поставить", mode: "interact", operation: "place", canonical: "place", target: "required" },
  { verb: "разместить", mode: "interact", operation: "place", canonical: "place", target: "required" },
  { verb: "оставить", mode: "interact", operation: "place", canonical: "place", target: "required" },
  { verb: "класть", mode: "interact", operation: "place", canonical: "place", target: "required" },
  { verb: "положу", mode: "interact", operation: "place", canonical: "place", target: "required" },
  { verb: "ставлю", mode: "interact", operation: "place", canonical: "place", target: "required" },
  // use (canonical v1)
  { verb: "использовать", mode: "interact", operation: "use", canonical: "use", target: "required" },
  { verb: "применить", mode: "interact", operation: "use", canonical: "use", target: "required" },
  { verb: "воспользоваться", mode: "interact", operation: "use", canonical: "use", target: "required" },
  { verb: "использу", mode: "interact", operation: "use", canonical: "use", target: "required" },
  { verb: "применя", mode: "interact", operation: "use", canonical: "use", target: "required" },
  // create_mark
  { verb: "нарисовать", mode: "interact", operation: "create_mark", target: "optional" },
  { verb: "наметить", mode: "interact", operation: "create_mark", target: "optional" },
  { verb: "оставить знак", mode: "interact", operation: "create_mark", target: "optional" },
  { verb: "написать", mode: "interact", operation: "create_mark", target: "optional" },
  { verb: "нацарапать", mode: "interact", operation: "create_mark", target: "optional" },
  { verb: "чертануть", mode: "interact", operation: "create_mark", target: "optional" },
  { verb: "рису", mode: "interact", operation: "create_mark", target: "optional" },
  { verb: "пишу", mode: "interact", operation: "create_mark", target: "optional" },
  { verb: "пишешь", mode: "interact", operation: "create_mark", target: "optional" },
  { verb: "пишет", mode: "interact", operation: "create_mark", target: "optional" },
  { verb: "пишем", mode: "interact", operation: "create_mark", target: "optional" },
  { verb: "пишете", mode: "interact", operation: "create_mark", target: "optional" },
  // speak
  { verb: "сказать", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "спросить", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "прошептать", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "произнести", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "обратиться", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "сказать", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "говорю", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "говоришь", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "говорит", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "говорим", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "говорите", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "спрашива", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "шепчу", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "шепчешь", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "шепчет", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "шепчем", mode: "communicate", operation: "speak", target: "optional" },
  { verb: "шепчете", mode: "communicate", operation: "speak", target: "optional" },
  // call
  { verb: "позвать", mode: "communicate", operation: "call", target: "optional" },
  { verb: "крикнуть", mode: "communicate", operation: "call", target: "optional" },
  { verb: "окликнуть", mode: "communicate", operation: "call", target: "optional" },
  { verb: "позыва", mode: "communicate", operation: "call", target: "optional" },
  { verb: "кричу", mode: "communicate", operation: "call", target: "optional" },
  { verb: "кричишь", mode: "communicate", operation: "call", target: "optional" },
  { verb: "кричит", mode: "communicate", operation: "call", target: "optional" },
  { verb: "кричим", mode: "communicate", operation: "call", target: "optional" },
  { verb: "кричите", mode: "communicate", operation: "call", target: "optional" },
  { verb: "зыва", mode: "communicate", operation: "call", target: "optional" },
  // wait
  { verb: "ждать", mode: "wait", operation: "wait", target: "forbidden" },
  { verb: "выждать", mode: "wait", operation: "wait", target: "forbidden" },
  { verb: "подождать", mode: "wait", operation: "wait", target: "forbidden" },
  { verb: "остановиться", mode: "travel", operation: "interrupt", target: "forbidden" },
  { verb: "жду", mode: "wait", operation: "wait", target: "forbidden" },
  { verb: "жди", mode: "wait", operation: "wait", target: "forbidden" },
  { verb: "ждем", mode: "wait", operation: "wait", target: "forbidden" },
  { verb: "ждете", mode: "wait", operation: "wait", target: "forbidden" },
  { verb: "ждёшь", mode: "wait", operation: "wait", target: "forbidden" },
  { verb: "ждёт", mode: "wait", operation: "wait", target: "forbidden" },
  { verb: "ждём", mode: "wait", operation: "wait", target: "forbidden" },
  { verb: "ждёте", mode: "wait", operation: "wait", target: "forbidden" },
  { verb: "подожд", mode: "wait", operation: "wait", target: "forbidden" },
  { verb: "погод", mode: "wait", operation: "wait", target: "forbidden" },
  // travel (ADR-0015 — Spatial Movement)
  { verb: "идти", mode: "travel", operation: "travel", target: "required" },
  { verb: "пойти", mode: "travel", operation: "travel", target: "required" },
  { verb: "направиться", mode: "travel", operation: "travel", target: "required" },
  { verb: "добраться", mode: "travel", operation: "travel", target: "required" },
  { verb: "перейти", mode: "travel", operation: "travel", target: "required" },
  { verb: "двигаться", mode: "travel", operation: "travel", target: "required" },
  { verb: "отправиться", mode: "travel", operation: "travel", target: "required" },
  { verb: "выбраться", mode: "travel", operation: "travel", target: "required" },
  { verb: "идём", mode: "travel", operation: "travel", target: "required" },
  { verb: "идёшь", mode: "travel", operation: "travel", target: "required" },
  { verb: "идёт", mode: "travel", operation: "travel", target: "required" },
  { verb: "идете", mode: "travel", operation: "travel", target: "required" },
  { verb: "иду", mode: "travel", operation: "travel", target: "required" },
  { verb: "go", mode: "travel", operation: "travel", target: "required" },
  { verb: "walk", mode: "travel", operation: "travel", target: "required" },
  { verb: "travel", mode: "travel", operation: "travel", target: "required" },
  { verb: "head", mode: "travel", operation: "travel", target: "required" },
  { verb: "move to", mode: "travel", operation: "travel", target: "required" },
] as const;

/**
 * ё→е normalization for matching. Raw player text is never rewritten;
 * `rawText` always carries the original input.
 */
function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

/** Length-sorted verb table used for longest-stem-first matching. */
const NORMALIZED_VERBS: readonly VerbEntry[] = [...VERBS]
  .map((entry) => ({ ...entry, verb: normalizeForMatch(entry.verb) }))
  .sort((a, b) => b.verb.length - a.verb.length);


/** Leading softener words («попытаться открыть сундук») are stripped before verb matching. */
const SOFTENER_PREFIX = /^(?:попытаться|попытаюсь|попытайтесь|попробовать|попробую|попробуй|попробуйте|пытаюсь|пытался)\s+/i;

const INSTRUMENT_MARKERS = [
  "с помощью",
  "инструментом",
  "посредством",
  "при помощи",
] as const;

const GOAL_MARKERS = [
  "чтобы",
  "чтоб",
  "для того",
  "с целью",
  "затем чтобы",
] as const;

/**
 * Canonical affordance vocabulary for the `use` operation (ADR-0032). A goal
 * clause names a physical operation an item exposes; the deterministic
 * interpreter maps the leading Russian goal verb to the canonical Affordance
 * string the action-capability rule consumes. Stems are matched left-to-right
 * so «чтобы зажечь траву» yields `ignite` with target «траву». Unmapped goal
 * verbs keep the raw goal and let the world reject honestly.
 */
const AFFORDANCE_GOAL_VERBS: readonly { readonly verb: string; readonly affordance: string }[] = [
  { verb: "зажечь", affordance: "ignite" },
  { verb: "зажига", affordance: "ignite" },
  { verb: "поджечь", affordance: "ignite" },
  { verb: "подпали", affordance: "ignite" },
  { verb: "разжечь", affordance: "ignite" },
  { verb: "осветить", affordance: "illuminate" },
  { verb: "освеща", affordance: "illuminate" },
  { verb: "светить", affordance: "illuminate" },
  { verb: "подсветить", affordance: "illuminate" },
  { verb: "привязать", affordance: "tie" },
  { verb: "привязыва", affordance: "tie" },
  { verb: "связать", affordance: "tie" },
  { verb: "завязать", affordance: "tie" },
  { verb: "закрепить", affordance: "secure" },
  { verb: "закрепля", affordance: "secure" },
  { verb: "прикрепить", affordance: "secure" },
  { verb: "заякорить", affordance: "anchor" },
  { verb: "спустить", affordance: "descend" },
  { verb: "опустить", affordance: "descend" },
  { verb: "подсадить", affordance: "assist_climbing" },
  { verb: "ударить", affordance: "strike" },
  { verb: "бить", affordance: "strike" },
  { verb: "стукнуть", affordance: "strike" },
  { verb: "вбить", affordance: "drive_nail" },
  { verb: "забить", affordance: "drive_nail" },
  { verb: "сломать", affordance: "break" },
  { verb: "ломать", affordance: "break" },
  { verb: "разбить", affordance: "break" },
  { verb: "придать форму", affordance: "shape" },
  { verb: "формовать", affordance: "shape" },
  { verb: "починить", affordance: "repair" },
  { verb: "чинить", affordance: "repair" },
  { verb: "отремонтировать", affordance: "repair" },
  { verb: "подать сигнал", affordance: "signal" },
  { verb: "сигналить", affordance: "signal" },
  { verb: "удержать", affordance: "contain" },
  { verb: "вместить", affordance: "contain" },
  { verb: "экспериментировать", affordance: "experiment" },
  { verb: "проверить", affordance: "experiment" },
] as const;

/** Prepositions separating a placed item from its container («положить камень в сумку»). */
const PLACE_CONTAINER_PREPOSITIONS = ["внутрь", "во", "в"] as const;

function splitPlaceTargets(afterVerb: string): { target?: IntentReference; secondaryTarget?: IntentReference } {
  const trimmed = afterVerb.trim();
  if (trimmed.length === 0) return {};
  for (const preposition of PLACE_CONTAINER_PREPOSITIONS) {
    const match = new RegExp(`(?:^|\\s)${preposition}\\s+`, "iu").exec(trimmed);
    if (!match) continue;
    const item = trimmed.slice(0, match.index).trim();
    const container = trimmed.slice(match.index + match[0].length).trim();
    if (item.length > 0 && container.length > 0) {
      return { target: { raw: item }, secondaryTarget: { raw: container } };
    }
  }
  return {};
}

function parseUseGoal(goal: string | undefined): { affordance: string | undefined; target: IntentReference | undefined } {
  if (!goal) return { affordance: undefined, target: undefined };
  const lower = normalizeForMatch(goal);
  for (const entry of AFFORDANCE_GOAL_VERBS) {
    if (lower.startsWith(entry.verb)) {
      const remainder = goal.slice(entry.verb.length).trim().replace(/^(?:на|в|по|с|об|над|под)\s+/i, "").trim();
      return { affordance: entry.affordance, target: remainder.length > 0 ? { raw: remainder } : undefined };
    }
  }
  return { affordance: undefined, target: undefined };
}

function isQuoteLike(text: string): boolean {
  const t = text.trim();
  return (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'")) ||
    t.endsWith("?")
  );
}

function stripQuotes(text: string): string {
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  if (trimmed.startsWith(":")) {
    return trimmed.replace(/^:\s*/, "").trim();
  }
  return trimmed;
}

function extractInstrument(text: string): { instrument: IntentReference | undefined; cleaned: string } {
  const lower = text.toLowerCase();
  for (const marker of INSTRUMENT_MARKERS) {
    const idx = lower.indexOf(marker);
    if (idx >= 0) {
      const after = text.slice(idx + marker.length).trim();
      const instrumentText = after.split(/\s+(?:чтобы|чтоб|для|с целью)\b/i)[0]?.trim() ?? after;
      if (instrumentText.length > 0) {
        const cleaned = (text.slice(0, idx).trim() + " " + text.slice(idx + marker.length + instrumentText.length).trim()).trim();
        return {
          instrument: { raw: instrumentText },
          cleaned: cleaned.length > 0 ? cleaned : text,
        };
      }
    }
  }
  return { instrument: undefined, cleaned: text };
}

function extractGoal(text: string): { goal: string | undefined; cleaned: string } {
  const lower = text.toLowerCase();
  for (const marker of GOAL_MARKERS) {
    const idx = lower.indexOf(marker);
    if (idx >= 0) {
      const goal = text.slice(idx + marker.length).trim();
      if (goal.length > 0) {
        return { goal, cleaned: text.slice(0, idx).trim() };
      }
    }
  }
  return { goal: undefined, cleaned: text };
}

function extractUtterance(text: string): { utterance: string | undefined; cleaned: string } {
  const trimmed = text.trim();

  const colonIdx = trimmed.indexOf(":");
  if (colonIdx >= 0 && colonIdx < trimmed.length - 1) {
    const before = trimmed.slice(0, colonIdx).trim();
    const after = trimmed.slice(colonIdx + 1).trim();
    if (after.length > 0) {
      return { utterance: after, cleaned: before };
    }
  }

  if (isQuoteLike(trimmed)) {
    return { utterance: stripQuotes(trimmed), cleaned: "" };
  }

  const quoteMatch = trimmed.match(/["']([^"']+)["']/);
  if (quoteMatch && quoteMatch[1]) {
    return {
      utterance: quoteMatch[1],
      cleaned: trimmed.replace(/["'][^"']+["']/, "").trim(),
    };
  }

  return { utterance: undefined, cleaned: trimmed };
}

function extractTarget(text: string): IntentReference | undefined {
  const cleaned = text.trim();
  if (cleaned.length === 0) return undefined;

  const withoutPrep = cleaned
    .replace(/^(?:к|в|на|у|из|от|до|по|про|для|между|перед|над|под|за|через)\s+/i, "")
    .trim();

  if (withoutPrep.length > 0 && withoutPrep !== cleaned) {
    return { raw: withoutPrep };
  }

  return { raw: cleaned };
}

function hasDirectionWords(text: string): boolean {
  const lower = text.toLowerCase();
  const directions = [
    "на север", "на юг", "на восток", "на запад",
    "север", "юг", "восток", "запад",
    "north", "south", "east", "west",
  ];
  return directions.some((d) => lower.includes(d));
}

function extractDirectionFromText(text: string): string | undefined {
  const lower = text.toLowerCase();
  const map: Record<string, string> = {
    "на север": "north",
    "север": "north",
    "на юг": "south",
    "юг": "south",
    "на восток": "east",
    "восток": "east",
    "на запад": "west",
    "запад": "west",
  };
  for (const [ru, en] of Object.entries(map)) {
    if (lower.includes(ru)) return en;
  }
  return undefined;
}

function extractApproachTarget(text: string): string | undefined {
  const cleaned = text.trim().replace(/[?!.,;:]+$/u, "");
  const match = /^(.*?)(?:\s+(?:с|из)\s+(?:север|юг|восток|запад)(?:а|у|ом|е)?|\s+(?:севернее|южнее|восточнее|западнее))$/iu.exec(cleaned);
  if (!match?.[1]) return undefined;
  const target = match[1]
    .trim()
    .replace(/^(?:к|в|на|у|из|от|до|по|через)\s+/iu, "")
    .trim();
  return target.length > 0 ? target : undefined;
}

function buildClarification(
  _text: string,
  candidates: Array<{ mode: IntentMode; operation: IntentOperation; label: string }>,
  clarificationId: string,
): ClarificationRequest {
  return {
    type: "ClarificationRequired",
    clarificationId,
    question: "Что именно ты хочешь сделать?",
    interpretations: candidates.map((c) => c.label),
  };
}

/**
 * Detect compound phrases: "осматриваюсь и иду к реке", "слушать, потом перехожу мост".
 * A single-action parser cannot silently execute only the first part.
 */
function hasCompoundConjunction(text: string): boolean {
  return /(?:^|\s)(?:и|а|но|или)\s+(?:иду|идти|пойти|направиться|двига|отправ|выбр|обойти|подойти|приблиз|войти|проник|залез|влез|пролез|попад|лезу|взять|поднять|забрать|достать|собрать|открыть|закрыть|отдать|передать|вручить|положить|поставить|разместить|оставить|класть|использовать|применить|воспользов|толкнуть|толка|удар|навали|выбить|сломать|пнуть|броса|вбить|вырвать|отодвинуть|нагреть|греть|поджечь|расплав|раскалить|остудить|охладить|нарисовать|написать|нацарапать|сказать|спросить|прошептать|позвать|крик|оклик|осматр|рассмотр|огля|посмотр|взгляд|провер|слуш|прислуш|подслуш|вслуш|трон|трог|прикосн|пощуп)/iu.test(text)
    || /(?:^|\s)(?:потом|затем|после|одновременно)\s+/iu.test(text);
}

const ROUTE_HINT_PATTERNS = [
  // Keep the route prefix separate from the destination: «по лесной дороге к башне».
  /^по\s+((?:.+?\s+)?(?:дорог(?:е|ой|а|у)|троп(?:е|ой|а|у)|маршрут(?:у|ом)|пут(?:и|ём|ем)))\s+(?=(?:к|в|на)\s+)/i,
  /^через\s+(.+?)\s+(?=(?:к|в|на)\s+)/i,
  /^(?:по|по\s+)(.+?\s+(?:дороге|тропе|маршруту|пути))/i,
  /^(?:через|через\s+)(.+?)$/i,
  /^(.+?\s+дорог(?:ой|а|у))/i,
  /^(.+?\s+троп(?:ой|а|у))/i,
] as const;

function stripRouteHintPrefix(text: string, routeHint: IntentReference | undefined): string {
  if (!routeHint) return text;
  const lowerText = text.toLowerCase();
  const lowerHint = routeHint.raw.toLowerCase();
  const hintIndex = lowerText.indexOf(lowerHint);
  if (hintIndex < 0) return text;
  return text.slice(hintIndex + routeHint.raw.length).trim();
}
function extractRouteHint(text: string): IntentReference | undefined {
  const trimmed = text.trim();
  for (const pattern of ROUTE_HINT_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      return { raw: match[1].trim() };
    }
  }
  return undefined;
}

export interface InterpreterOptions {
  readonly clarificationThreshold?: number;
}

const DEFAULT_CONFIDENCE_THRESHOLD = 0.4;

interface CanonicalParts {
  readonly target?: IntentReference | undefined;
  readonly secondaryTarget?: IntentReference | undefined;
}

/**
 * give splits the remainder into item (first word) and recipient (the rest):
 * «отдать пепел торговцу» → пепел / торговцу. v1 keeps the fixed word order
 * item-first; other orders report ambiguity through interpretation.
 */
function splitGiveTargets(afterVerb: string): CanonicalParts {
  const trimmed = afterVerb.trim();
  if (trimmed.length === 0) return {};
  const words = trimmed.split(/\s+/);
  const rest = words.slice(1).join(" ").replace(/^(?:и|а|к|для|до)\s+/i, "").trim();
  if (rest.length > 0) {
    return { target: { raw: words[0]! }, secondaryTarget: { raw: rest } };
  }
  return { target: { raw: words[0]! } };
}

/** Concrete-target extraction with trailing punctuation and leading preposition stripped. */
function canonicalTarget(afterVerb: string): IntentReference | undefined {
  const original = afterVerb.trim();
  const cleaned = original.replace(/[?!.,;:]+$/u, "");
  // Preserve punctuation-only input as malformed target; do not silently
  // reinterpret a concrete command as an ambient observation.
  if (cleaned.length === 0) return original.length > 0 ? { raw: original } : undefined;
  const withoutPrep = cleaned
    .replace(/^(?:к|в|на|у|из|от|до|по|про|для|между|перед|над|под|за|через)\s+/i, "")
    .trim();
  if (withoutPrep.length > 0 && withoutPrep !== cleaned) return { raw: withoutPrep };
  return { raw: cleaned };
}
function isAmbientModifier(target: IntentReference | undefined): boolean {
  if (!target) return false;
  const value = target.raw.trim().toLowerCase();
  return ["звук", "звуки", "звуков", "шум", "шумы", "окружение", "окрестности", "вокруг", "тишина"].includes(value);
}


/**
 * A stem match may leave a conjugation remnant («осматрива» → «ю дверь»,
 * «изуч» → «аю петли»). Deterministic v1: strip one leading verb ending
 * (longest first) when the remnant starts a target phrase. Never applied to
 * the raw text, only to the derived target fields.
 *
 * This list is also used to validate that a token remainder after a verb
 * stem is a legitimate conjugation ending (not a separate word that should
 * become a target).
 */
const VERB_ENDINGS = [
  "ешься", "етесь", "ите", "ешь", "ется", "аете", "ают", "ять",
  "аем", "ает", "аю", "емся", "ит", "им", "ат", "ют", "ить",
  "ать", "ила", "или", "ил", "ал", "ала", "али", "ло", "ял",
  // Reflexive endings (must precede shorter "ся"/"сь"/"ю")
  "юсь", "усь", "ишься", "ится", "имся", "итесь", "ятся",
  "ся", "сь", "ю", "л",
] as const;

/**
 * Check whether `remainder` is a valid verb conjugation ending.
 * Used to validate that a word token is entirely a verb form
 * (stem + known ending) and not stem + random text.
 */
function isValidVerbEnding(remainder: string): boolean {
  for (const ending of VERB_ENDINGS) {
    if (remainder === ending) return true;
  }
  return false;
}

/** Returns the single source of truth for canonical interaction valency. */
export function targetRequirementForInteraction(verb: InteractionVerb): TargetRequirement | undefined {
  return VERBS.find((entry) => entry.canonical === verb || entry.operation === verb)?.target;
}

/** Returns valency metadata for a legacy operation when one is registered. */
export function targetRequirementForOperation(operation: IntentOperation): TargetRequirement | undefined {
  return VERBS.find((entry) => entry.operation === operation)?.target;
}

/** Word boundary regex for tokenization — matches Cyrillic letters, Latin, digits. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**

 * Find the start index of the word containing position `pos` in `text`.
 */
function wordStart(text: string, pos: number): number {
  let i = pos;
  while (i > 0 && WORD_CHAR.test(text[i - 1])) i--;
  return i;
}

/**
 * Find the end index (exclusive) of the word containing position `pos` in `text`.
 */
function wordEnd(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && WORD_CHAR.test(text[i])) i++;
  return i;
}

/**
 * Match result with word boundaries so the caller can consume the entire
 * word token instead of just the matched stem prefix.
 */
interface VerbMatch {
  readonly entry: VerbEntry;
  /** Start of the matched word in the normalized text. */
  readonly wordStart: number;
  /** End (exclusive) of the matched word in the normalized text. */
  readonly wordEnd: number;
}

/**
 * Find the best verb match in `text`.
 *
 * Priority: longest stem first. The entire word token containing the stem
 * must be a valid verb form (stem + known ending, or exact stem match).
 * This prevents "осматриваюсь" from being split into stem "осматрива" + target "юсь".
 */
function findBestVerb(text: string): VerbMatch | undefined {
  const lower = normalizeForMatch(text);
  for (const entry of NORMALIZED_VERBS) {
    const idx = lower.indexOf(entry.verb);
    if (idx < 0) continue;

    const wStart = wordStart(lower, idx);
    const wEnd = wordEnd(lower, idx + entry.verb.length);
    const word = lower.slice(wStart, wEnd);
    const matchOffset = idx - wStart;
    if (matchOffset !== 0) continue;
    const afterStem = word.slice(matchOffset + entry.verb.length);

    // The entire word must be a valid verb form:
    //   - exact stem match (afterStem is empty), or
    //   - stem + known conjugation ending.
    if (afterStem.length === 0 || isValidVerbEnding(afterStem)) {
      return { entry, wordStart: wStart, wordEnd: wEnd };
    }
  }
  return undefined;
}

function buildInteractionCommand(
  verb: InteractionVerb,
  parts: CanonicalParts,
  instrument: IntentReference | undefined,
  goal: string | undefined,
  rawText: string,
  ambiguities: readonly string[],
  manner?: string | undefined,
): InteractionCommand {
  let confidence = 0.7;
  if (parts.target) confidence += 0.1;
  if (parts.secondaryTarget) confidence += 0.1;
  if (instrument) confidence += 0.05;
  if (goal) confidence += 0.05;
  confidence = Math.min(1.0, Math.round(confidence * 100) / 100);
  return {
    type: "InteractionCommand",
    verb,
    target: parts.target,
    secondaryTarget: parts.secondaryTarget,
    instrument,
    goal,
    manner,
    rawText,
    interpretation: { source: "deterministic", confidence, ambiguities },
  };
}

/**
 * Canonical Interaction Model v1 branch (ADR-0013 §2): maps the matched verb
 * stem to the canonical InteractionVerb and reports structural problems
 * (empty target, give without recipient, compound intents) through
 * interpretation meta or UnsupportedIntent — never through world checks.
 */
function buildCanonical(
  verb: InteractionVerb,
  afterVerb: string,
  context: { instrument: IntentReference | undefined; goal: string | undefined; rawText: string },
): InteractionCommand | UnsupportedIntent | ClarificationRequest {
  const remainder = afterVerb.trim();
  const compound = false;

  let parts: CanonicalParts;
  let instrument = context.instrument;
  let goal = context.goal;

  if (verb === "give") {
    parts = splitGiveTargets(remainder);
  } else if (verb === "place") {
    parts = splitPlaceTargets(remainder);
    if (!parts.target && remainder.trim().length > 0) parts = { target: { raw: remainder.trim() } };
  } else if (verb === "use") {
    const useGoal = parseUseGoal(context.goal);
    const tool = remainder.trim().length > 0 ? { raw: remainder.trim() } : undefined;
    instrument = instrument ?? tool;
    if (useGoal.affordance) {
      goal = useGoal.affordance;
      parts = useGoal.target ? { target: useGoal.target } : {};
    } else {
      const target = canonicalTarget(remainder);
      parts = target ? { target } : {};
    }
  } else {
    const target = canonicalTarget(remainder);
    parts = (verb === "listen" || verb === "observe" || verb === "inspect") && isAmbientModifier(target) ? {} : target ? { target } : {};
  }

  const ambiguities: string[] = [];
  if (!parts.target) {
    ambiguities.push(verb === "give" ? "give without an item" : "no clear target identified");
  }
  if (verb === "give" && parts.target && !parts.secondaryTarget) {
    ambiguities.push("give without a recipient");
  }

  const command = buildInteractionCommand(verb, parts, instrument, goal, context.rawText, ambiguities);

  if (compound) {
    return buildClarification(
      context.rawText,
      [{ mode: "perceive", operation: "observe", label: `${verb} — ${afterVerb || "окружение"}` }],
      `compound-${Date.now()}`,
    );
  }
  return command;
}

export function interpretIntent(
  rawText: string,
  options?: InterpreterOptions,
): IntentResult {
  const threshold = options?.clarificationThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const trimmed = rawText.trim();

  if (trimmed.length === 0) {
    return {
      type: "ActionIntentCommand",
      mode: "wait",
      operation: "wait",
      rawText,
      interpretation: { source: "deterministic", confidence: 0, ambiguities: ["empty input"] },
    };
  }

  let text = normalizeForMatch(trimmed);
  const { instrument, cleaned: afterInstrument } = extractInstrument(text);
  text = afterInstrument;
  const { goal, cleaned: afterGoal } = extractGoal(text);
  text = afterGoal;
  const { utterance, cleaned: afterUtterance } = extractUtterance(text);
  text = afterUtterance.replace(SOFTENER_PREFIX, "").trim();

  const verbMatch = findBestVerb(text);

  if (!verbMatch) {
    if (hasDirectionWords(text)) {
      const dir = extractDirectionFromText(text);
      return {
        type: "ActionIntentCommand",
        mode: "relocate",
        operation: "approach",
        target: dir ? { raw: dir, normalized: dir } : undefined,
        rawText,
        interpretation: { source: "deterministic", confidence: 0.5, ambiguities: ["inferred direction from context"] },
      };
    }

    if (trimmed.endsWith("?") || trimmed.startsWith("кто") || trimmed.startsWith("что") || trimmed.startsWith("где") || trimmed.startsWith("как")) {
      return {
        type: "ActionIntentCommand",
        mode: "communicate",
        operation: "speak",
        utterance: trimmed,
        rawText,
        interpretation: { source: "deterministic", confidence: 0.6, ambiguities: ["inferred as speech from question form"] },
      };
    }

    return {
      type: "ActionIntentCommand",
      mode: "interact",
      operation: "unknown",
      rawText,
      interpretation: { source: "deterministic", confidence: 0, ambiguities: ["no recognized verb or action pattern"] },
    };
  }

  const verb = verbMatch.entry;
  const afterVerbRaw = text.slice(verbMatch.wordEnd).trim();

  // Compound phrase detection: "осматриваюсь и иду к реке", "слушать перевозчика, потом перейти мост".
  // Check BEFORE stripping conjunctions so "и иду" is still visible.
  if (verb.canonical && hasCompoundConjunction(afterVerbRaw)) {
    return buildClarification(
      rawText,
      [{ mode: "perceive", operation: "observe", label: `${verb.canonical} — ${afterVerbRaw || "окружение"}` }],
      `compound-${Date.now()}`,
    );
  }

  // Consume the entire word token, not just the matched stem prefix.
  // This prevents "осматриваюсь" from producing "юсь" as a target.
  const afterVerb = afterVerbRaw
    .replace(/^(?:и|а|но|или|то|же|бы|ли)\s+/i, "")
    .trim();

  if (verb.operation === "approach" || verb.operation === "enter") {
    // «обойти башню с запада» names a target plus an approach direction;
    // do not mistake the directional modifier for the target itself.
    const approachTarget = extractApproachTarget(afterVerb);
    if (approachTarget) {
      return {
        type: "ActionIntentCommand",
        mode: verb.mode,
        operation: verb.operation,
        target: { raw: approachTarget, normalized: normalizeForMatch(approachTarget) },
        instrument,
        goal,
        rawText,
        interpretation: { source: "deterministic", confidence: 0.8, ambiguities: [] },
      };
    }
    const dir = extractDirectionFromText(afterVerb);
    if (dir) {
      return {
        type: "ActionIntentCommand",
        mode: verb.mode,
        operation: verb.operation,
        target: { raw: dir, normalized: dir },
        instrument,
        goal,
        rawText,
        interpretation: { source: "deterministic", confidence: 0.8, ambiguities: [] },
      };
    }
  }

  if (verb.operation === "wait") {
    return {
      type: "ActionIntentCommand",
      mode: "wait",
      operation: "wait",
      rawText,
      interpretation: { source: "deterministic", confidence: 0.9, ambiguities: [] },
    };
  }

  if (verb.operation === "interrupt") {
    return {
      type: "ActionIntentCommand",
      mode: "travel",
      operation: "interrupt",
      rawText,
      interpretation: { source: "deterministic", confidence: 0.95, ambiguities: [] },
    };
  }

  // Spatial Movement: travel verbs produce JourneyIntent (ADR-0015)
  // But direction words ("на север") still produce legacy relocate
  if (verb.mode === "travel") {
    const dir = extractDirectionFromText(afterVerb);
    if (dir) {
      return {
        type: "ActionIntentCommand",
        mode: "relocate",
        operation: "approach",
        target: { raw: dir, normalized: dir },
        rawText,
        interpretation: { source: "deterministic", confidence: 0.8, ambiguities: [] },
      };
    }
    const routeHint = extractRouteHint(afterVerb);
    const destination = extractTarget(stripRouteHintPrefix(afterVerb, routeHint));
    return {
      type: "JourneyIntent",
      destination: destination ?? { raw: "" },
      routeHint,
      rawText,
      interpretation: { source: "deterministic", confidence: destination ? 0.8 : 0.5, ambiguities: destination ? [] : ["no clear destination"] },
    };
  }

  if (verb.canonical) {
    return buildCanonical(verb.canonical, afterVerb, { instrument, goal, rawText });
  }

  // Compound phrase detection for non-canonical verbs:
  // "наваливаюсь плечом и толкаю дверь" — single-action parser cannot
  // silently execute only the first part.
  if (hasCompoundConjunction(afterVerb)) {
    return buildClarification(
      rawText,
      [{ mode: verb.mode, operation: verb.operation, label: `${verb.operation} — ${afterVerb || "окружение"}` }],
      `compound-${Date.now()}`,
    );
  }

  // place/use carry a tool + acted-on + canonical goal. The catch-all target
  // split below must not swallow the whole remainder («положить камень в
  // сумку» → камень / сумку; «использовать факел чтобы зажечь траву» →
  // instrument факел, target траву, goal ignite).
  let finalSecondaryTarget = undefined as IntentReference | undefined;
  let finalInstrument = instrument;
  let finalGoal = goal;
  let preTarget: IntentReference | undefined;

  if (verb.operation === "place") {
    const parts = splitPlaceTargets(afterVerb);
    preTarget = parts.target;
    finalSecondaryTarget = parts.secondaryTarget;
  } else if (verb.operation === "use") {
    const useGoal = parseUseGoal(goal);
    const tool = afterVerb.trim().length > 0 ? { raw: afterVerb.trim() } : undefined;
    finalInstrument = instrument ?? tool;
    if (useGoal.affordance) {
      finalGoal = useGoal.affordance;
      preTarget = useGoal.target;
    }
  }

  const target = preTarget ?? extractTarget(afterVerb);

  let finalUtterance = utterance;
  let finalTarget = target;
  if (verb.operation === "speak" || verb.operation === "call") {
    if (!finalUtterance && afterVerb.length > 0) {
      finalUtterance = afterVerb;
      finalTarget = undefined;
    }
  }

  let confidence = 0.7;
  if (finalTarget) confidence += 0.1;
  if (finalSecondaryTarget) confidence += 0.1;
  if (finalInstrument) confidence += 0.05;
  if (finalGoal) confidence += 0.05;
  confidence = Math.min(confidence, 1.0);

  const ambiguities: string[] = [];
  if (!finalTarget && verb.mode !== "wait") {
    ambiguities.push("no clear target identified");
  }

  if (confidence < threshold && ambiguities.length > 0) {
    const candidates = [
      { mode: verb.mode, operation: verb.operation, label: `${verb.operation} — ${afterVerb || "no target"}` },
    ];
    return buildClarification(rawText, candidates, `clar-${Date.now()}`);
  }

  return {
    type: "ActionIntentCommand",
    mode: verb.mode,
    operation: verb.operation,
    target: finalTarget,
    secondaryTarget: finalSecondaryTarget,
    instrument: finalInstrument,
    goal: finalGoal,
    manner: undefined,
    utterance: finalUtterance,
    rawText,
    interpretation: { source: "deterministic", confidence, ambiguities },
  };
}
