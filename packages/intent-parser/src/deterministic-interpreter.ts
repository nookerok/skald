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
}

const VERBS: readonly VerbEntry[] = [
  // observe (canonical v1, Slice 1 — ADR-0013 §2)
  { verb: "осмотреть", mode: "perceive", operation: "observe", canonical: "observe" },
  { verb: "осматрива", mode: "perceive", operation: "observe", canonical: "observe" },
  { verb: "рассмотреть", mode: "perceive", operation: "observe", canonical: "observe" },
  { verb: "оглядеть", mode: "perceive", operation: "observe", canonical: "observe" },
  { verb: "оглянуть", mode: "perceive", operation: "observe", canonical: "observe" },
  { verb: "посмотреть", mode: "perceive", operation: "observe", canonical: "observe" },
  { verb: "взглянуть", mode: "perceive", operation: "observe", canonical: "observe" },
  { verb: "проверить", mode: "perceive", operation: "observe", canonical: "observe" },
  { verb: "осмотр", mode: "perceive", operation: "observe", canonical: "observe" },
  { verb: "рассматрив", mode: "perceive", operation: "observe", canonical: "observe" },
  { verb: "посмотр", mode: "perceive", operation: "observe", canonical: "observe" },
  { verb: "взгляд", mode: "perceive", operation: "observe", canonical: "observe" },
  // inspect (canonical v1, Slice 1)
  { verb: "изучить", mode: "perceive", operation: "observe", canonical: "inspect" },
  { verb: "изуч", mode: "perceive", operation: "observe", canonical: "inspect" },
  { verb: "роздать", mode: "perceive", operation: "observe" },
  // listen (canonical v1, Slice 2 — ADR-0013 §2)
  { verb: "слушать", mode: "perceive", operation: "listen", canonical: "listen" },
  { verb: "прислушаться", mode: "perceive", operation: "listen", canonical: "listen" },
  { verb: "прислушать", mode: "perceive", operation: "listen", canonical: "listen" },
  { verb: "подслушать", mode: "perceive", operation: "listen", canonical: "listen" },
  { verb: "вслушаться", mode: "perceive", operation: "listen", canonical: "listen" },
  { verb: "вслушать", mode: "perceive", operation: "listen", canonical: "listen" },
  { verb: "прислушива", mode: "perceive", operation: "listen", canonical: "listen" },
  { verb: "слуш", mode: "perceive", operation: "listen", canonical: "listen" },
  // touch
  { verb: "тронуть", mode: "perceive", operation: "touch" },
  { verb: "трогать", mode: "perceive", operation: "touch" },
  { verb: "прикоснуться", mode: "perceive", operation: "touch" },
  { verb: "прикоснуть", mode: "perceive", operation: "touch" },
  { verb: "пощупать", mode: "perceive", operation: "touch" },
  { verb: "пощупа", mode: "perceive", operation: "touch" },
  { verb: "ладонь", mode: "perceive", operation: "touch" },
  { verb: "рукой", mode: "perceive", operation: "touch" },
  { verb: "потрогать", mode: "perceive", operation: "touch" },
  // approach / relocate
  { verb: "подойти", mode: "relocate", operation: "approach" },
  { verb: "приблизиться", mode: "relocate", operation: "approach" },
  { verb: "приблизить", mode: "relocate", operation: "approach" },
  { verb: "направиться", mode: "relocate", operation: "approach" },
  { verb: "подобраться", mode: "relocate", operation: "approach" },
  { verb: "подобрать", mode: "relocate", operation: "approach" },
  { verb: "обойти", mode: "relocate", operation: "approach" },
  { verb: "обхожу", mode: "relocate", operation: "approach" },
  { verb: "подход", mode: "relocate", operation: "approach" },
  // enter
  { verb: "войти", mode: "relocate", operation: "enter" },
  { verb: "входить", mode: "relocate", operation: "enter" },
  { verb: "проникнуть", mode: "relocate", operation: "enter" },
  { verb: "проникать", mode: "relocate", operation: "enter" },
  { verb: "залезть", mode: "relocate", operation: "enter" },
  { verb: "влезть", mode: "relocate", operation: "enter" },
  { verb: "пролезть", mode: "relocate", operation: "enter" },
  { verb: "попасть", mode: "relocate", operation: "enter" },
  { verb: "лезу", mode: "relocate", operation: "enter" },
  { verb: "влеза", mode: "relocate", operation: "enter" },
  { verb: "забира", mode: "relocate", operation: "enter" },
  // apply_force
  { verb: "толкнуть", mode: "interact", operation: "apply_force" },
  { verb: "толкать", mode: "interact", operation: "apply_force" },
  { verb: "ударить", mode: "interact", operation: "apply_force" },
  { verb: "ударять", mode: "interact", operation: "apply_force" },
  { verb: "навалиться", mode: "interact", operation: "apply_force" },
  { verb: "наваливать", mode: "interact", operation: "apply_force" },
  { verb: "наваливаю", mode: "interact", operation: "apply_force" },
  { verb: "наваливаешь", mode: "interact", operation: "apply_force" },
  { verb: "наваливает", mode: "interact", operation: "apply_force" },
  { verb: "наваливаем", mode: "interact", operation: "apply_force" },
  { verb: "наваливаете", mode: "interact", operation: "apply_force" },
  { verb: "выбить", mode: "interact", operation: "apply_force" },
  { verb: "сломать", mode: "interact", operation: "apply_force" },
  { verb: "вдавить", mode: "interact", operation: "apply_force" },
  { verb: "пнуть", mode: "interact", operation: "apply_force" },
  { verb: "бросить", mode: "interact", operation: "apply_force" },
  { verb: "броса", mode: "interact", operation: "apply_force" },
  { verb: "пина", mode: "interact", operation: "apply_force" },
  { verb: "вбить", mode: "interact", operation: "apply_force" },
  { verb: "вбива", mode: "interact", operation: "apply_force" },
  { verb: "вырвать", mode: "interact", operation: "apply_force" },
  { verb: "вырыва", mode: "interact", operation: "apply_force" },
  { verb: "отодвинуть", mode: "interact", operation: "apply_force" },
  { verb: "поддеть", mode: "interact", operation: "apply_force" },
  { verb: "поддева", mode: "interact", operation: "apply_force" },
  { verb: "тяну", mode: "interact", operation: "apply_force" },
  { verb: "дёрнуть", mode: "interact", operation: "apply_force" },
  { verb: "дёрга", mode: "interact", operation: "apply_force" },
  // heat
  { verb: "нагреть", mode: "interact", operation: "heat" },
  { verb: "греть", mode: "interact", operation: "heat" },
  { verb: "поджечь", mode: "interact", operation: "heat" },
  { verb: "поджиг", mode: "interact", operation: "heat" },
  { verb: "поднести огонь", mode: "interact", operation: "heat" },
  { verb: "оплавить", mode: "interact", operation: "heat" },
  { verb: "расплавить", mode: "interact", operation: "heat" },
  { verb: "расплавл", mode: "interact", operation: "heat" },
  { verb: "раскалить", mode: "interact", operation: "heat" },
  { verb: "нагрева", mode: "interact", operation: "heat" },
  { verb: "грею", mode: "interact", operation: "heat" },
  { verb: "греешь", mode: "interact", operation: "heat" },
  { verb: "греет", mode: "interact", operation: "heat" },
  { verb: "греем", mode: "interact", operation: "heat" },
  { verb: "греете", mode: "interact", operation: "heat" },
  { verb: "греете", mode: "interact", operation: "heat" },
  { verb: "подношу огонь", mode: "interact", operation: "heat" },
  { verb: "подношу огонь", mode: "interact", operation: "heat" },
  { verb: "поднес", mode: "interact", operation: "heat" },
  // cool
  { verb: "остудить", mode: "interact", operation: "cool" },
  { verb: "охладить", mode: "interact", operation: "cool" },
  { verb: "залить", mode: "interact", operation: "cool" },
  { verb: "накрыть", mode: "interact", operation: "cool" },
  // take (canonical v1)
  { verb: "взять", mode: "interact", operation: "take", canonical: "take" },
  { verb: "поднять", mode: "interact", operation: "take", canonical: "take" },
  { verb: "забрать", mode: "interact", operation: "take", canonical: "take" },
  { verb: "достать", mode: "interact", operation: "take", canonical: "take" },
  { verb: "собрать", mode: "interact", operation: "take", canonical: "take" },
  { verb: "взял", mode: "interact", operation: "take", canonical: "take" },
  { verb: "беру", mode: "interact", operation: "take", canonical: "take" },
  { verb: "берешь", mode: "interact", operation: "take", canonical: "take" },
  { verb: "берет", mode: "interact", operation: "take", canonical: "take" },
  { verb: "берем", mode: "interact", operation: "take", canonical: "take" },
  { verb: "берете", mode: "interact", operation: "take", canonical: "take" },
  { verb: "собира", mode: "interact", operation: "take", canonical: "take" },
  // open (canonical v1)
  { verb: "открыть", mode: "interact", operation: "open", canonical: "open" },
  { verb: "открыва", mode: "interact", operation: "open", canonical: "open" },
  { verb: "открою", mode: "interact", operation: "open", canonical: "open" },
  { verb: "открой", mode: "interact", operation: "open", canonical: "open" },
  { verb: "открыл", mode: "interact", operation: "open", canonical: "open" },
  { verb: "приоткрыть", mode: "interact", operation: "open", canonical: "open" },
  { verb: "приоткрыва", mode: "interact", operation: "open", canonical: "open" },
  { verb: "распахнуть", mode: "interact", operation: "open", canonical: "open" },
  { verb: "распахива", mode: "interact", operation: "open", canonical: "open" },
  { verb: "раскрыть", mode: "interact", operation: "open", canonical: "open" },
  { verb: "раскрыва", mode: "interact", operation: "open", canonical: "open" },
  // give (canonical v1)
  { verb: "отдать", mode: "interact", operation: "give", canonical: "give" },
  { verb: "отдам", mode: "interact", operation: "give", canonical: "give" },
  { verb: "отдай", mode: "interact", operation: "give", canonical: "give" },
  { verb: "отдаю", mode: "interact", operation: "give", canonical: "give" },
  { verb: "отдава", mode: "interact", operation: "give", canonical: "give" },
  { verb: "отдает", mode: "interact", operation: "give", canonical: "give" },
  { verb: "отдаешь", mode: "interact", operation: "give", canonical: "give" },
  { verb: "передать", mode: "interact", operation: "give", canonical: "give" },
  { verb: "передам", mode: "interact", operation: "give", canonical: "give" },
  { verb: "передай", mode: "interact", operation: "give", canonical: "give" },
  { verb: "передаю", mode: "interact", operation: "give", canonical: "give" },
  { verb: "передава", mode: "interact", operation: "give", canonical: "give" },
  { verb: "передает", mode: "interact", operation: "give", canonical: "give" },
  { verb: "вручить", mode: "interact", operation: "give", canonical: "give" },
  { verb: "вруча", mode: "interact", operation: "give", canonical: "give" },
  // place
  { verb: "положить", mode: "interact", operation: "place" },
  { verb: "поставить", mode: "interact", operation: "place" },
  { verb: "разместить", mode: "interact", operation: "place" },
  { verb: "оставить", mode: "interact", operation: "place" },
  { verb: "класть", mode: "interact", operation: "place" },
  { verb: "положу", mode: "interact", operation: "place" },
  { verb: "ставлю", mode: "interact", operation: "place" },
  // use
  { verb: "использовать", mode: "interact", operation: "use" },
  { verb: "применить", mode: "interact", operation: "use" },
  { verb: "воспользоваться", mode: "interact", operation: "use" },
  { verb: "использу", mode: "interact", operation: "use" },
  { verb: "применя", mode: "interact", operation: "use" },
  // create_mark
  { verb: "нарисовать", mode: "interact", operation: "create_mark" },
  { verb: "наметить", mode: "interact", operation: "create_mark" },
  { verb: "оставить знак", mode: "interact", operation: "create_mark" },
  { verb: "написать", mode: "interact", operation: "create_mark" },
  { verb: "нацарапать", mode: "interact", operation: "create_mark" },
  { verb: "чертануть", mode: "interact", operation: "create_mark" },
  { verb: "рису", mode: "interact", operation: "create_mark" },
  { verb: "пишу", mode: "interact", operation: "create_mark" },
  { verb: "пишешь", mode: "interact", operation: "create_mark" },
  { verb: "пишет", mode: "interact", operation: "create_mark" },
  { verb: "пишем", mode: "interact", operation: "create_mark" },
  { verb: "пишете", mode: "interact", operation: "create_mark" },
  // speak
  { verb: "сказать", mode: "communicate", operation: "speak" },
  { verb: "спросить", mode: "communicate", operation: "speak" },
  { verb: "прошептать", mode: "communicate", operation: "speak" },
  { verb: "произнести", mode: "communicate", operation: "speak" },
  { verb: "обратиться", mode: "communicate", operation: "speak" },
  { verb: "сказать", mode: "communicate", operation: "speak" },
  { verb: "говорю", mode: "communicate", operation: "speak" },
  { verb: "говоришь", mode: "communicate", operation: "speak" },
  { verb: "говорит", mode: "communicate", operation: "speak" },
  { verb: "говорим", mode: "communicate", operation: "speak" },
  { verb: "говорите", mode: "communicate", operation: "speak" },
  { verb: "спрашива", mode: "communicate", operation: "speak" },
  { verb: "шепчу", mode: "communicate", operation: "speak" },
  { verb: "шепчешь", mode: "communicate", operation: "speak" },
  { verb: "шепчет", mode: "communicate", operation: "speak" },
  { verb: "шепчем", mode: "communicate", operation: "speak" },
  { verb: "шепчете", mode: "communicate", operation: "speak" },
  // call
  { verb: "позвать", mode: "communicate", operation: "call" },
  { verb: "крикнуть", mode: "communicate", operation: "call" },
  { verb: "окликнуть", mode: "communicate", operation: "call" },
  { verb: "позыва", mode: "communicate", operation: "call" },
  { verb: "кричу", mode: "communicate", operation: "call" },
  { verb: "кричишь", mode: "communicate", operation: "call" },
  { verb: "кричит", mode: "communicate", operation: "call" },
  { verb: "кричим", mode: "communicate", operation: "call" },
  { verb: "кричите", mode: "communicate", operation: "call" },
  { verb: "зыва", mode: "communicate", operation: "call" },
  // wait
  { verb: "ждать", mode: "wait", operation: "wait" },
  { verb: "выждать", mode: "wait", operation: "wait" },
  { verb: "подождать", mode: "wait", operation: "wait" },
  { verb: "остановиться", mode: "travel", operation: "interrupt" },
  { verb: "жду", mode: "wait", operation: "wait" },
  { verb: "жди", mode: "wait", operation: "wait" },
  { verb: "ждем", mode: "wait", operation: "wait" },
  { verb: "ждете", mode: "wait", operation: "wait" },
  { verb: "ждёшь", mode: "wait", operation: "wait" },
  { verb: "ждёт", mode: "wait", operation: "wait" },
  { verb: "ждём", mode: "wait", operation: "wait" },
  { verb: "ждёте", mode: "wait", operation: "wait" },
  { verb: "подожд", mode: "wait", operation: "wait" },
  { verb: "погод", mode: "wait", operation: "wait" },
  // travel (ADR-0015 — Spatial Movement)
  { verb: "идти", mode: "travel", operation: "travel" },
  { verb: "пойти", mode: "travel", operation: "travel" },
  { verb: "направиться", mode: "travel", operation: "travel" },
  { verb: "добраться", mode: "travel", operation: "travel" },
  { verb: "перейти", mode: "travel", operation: "travel" },
  { verb: "двигаться", mode: "travel", operation: "travel" },
  { verb: "отправиться", mode: "travel", operation: "travel" },
  { verb: "выбраться", mode: "travel", operation: "travel" },
  { verb: "идём", mode: "travel", operation: "travel" },
  { verb: "идёшь", mode: "travel", operation: "travel" },
  { verb: "идёт", mode: "travel", operation: "travel" },
  { verb: "идете", mode: "travel", operation: "travel" },
  { verb: "иду", mode: "travel", operation: "travel" },
  { verb: "go", mode: "travel", operation: "travel" },
  { verb: "walk", mode: "travel", operation: "travel" },
  { verb: "travel", mode: "travel", operation: "travel" },
  { verb: "head", mode: "travel", operation: "travel" },
  { verb: "move to", mode: "travel", operation: "travel" },
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

/** Canonical-only stem index for compound-intent rejection (ADR-0013 §8). */
const CANONICAL_VERBS: readonly VerbEntry[] = NORMALIZED_VERBS.filter(
  (entry) => entry.canonical !== undefined,
);

function findCanonicalStem(text: string): VerbEntry | undefined {
  const lower = normalizeForMatch(text);
  for (const entry of CANONICAL_VERBS) {
    if (lower.includes(entry.verb)) return entry;
  }
  return undefined;
}

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

function findBestVerb(text: string): VerbEntry | undefined {
  const lower = normalizeForMatch(text);
  for (const entry of NORMALIZED_VERBS) {
    if (lower.includes(entry.verb)) {
      return entry;
    }
  }
  return undefined;
}

function removeVerb(text: string, verb: string): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(verb);
  if (idx < 0) return text;

  const before = text.slice(0, idx).trim();
  const after = text.slice(idx + verb.length).trim();

  const combined = (before + " " + after).trim();
  return combined
    .replace(/^(?:и|а|но|или|то|же|бы|ли)\s+/i, "")
    .replace(/\s+(?:и|а|но|или|то|же|бы|ли)$/i, "")
    .trim();
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
  const cleaned = afterVerb.trim().replace(/[?!.,;:]+$/u, "");
  if (cleaned.length === 0) return undefined;
  const withoutPrep = cleaned
    .replace(/^(?:к|в|на|у|из|от|до|по|про|для|между|перед|над|под|за|через)\s+/i, "")
    .trim();
  if (withoutPrep.length > 0 && withoutPrep !== cleaned) return { raw: withoutPrep };
  return { raw: cleaned };
}
function isAmbientListenTarget(target: IntentReference | undefined): boolean {
  if (!target) return false;
  const value = target.raw.trim().toLowerCase();
  return ["звук", "звуки", "звуков", "шум", "шумы", "окружение", "окрестности", "вокруг", "тишина"].includes(value);
}


/**
 * A stem match may leave a conjugation remnant («осматрива» → «ю дверь»,
 * «изуч» → «аю петли»). Deterministic v1: strip one leading verb ending
 * (longest first) when the remnant starts a target phrase. Never applied to
 * the raw text, only to the derived target fields.
 */
const VERB_ENDINGS = [
  "ешься", "етесь", "ите", "ешь", "ется", "аете", "ают", "ять",
  "аем", "ает", "аю", "емся", "ит", "им", "ат", "ют", "ить",
  "ать", "ила", "или", "ил", "ал", "ала", "али", "ло", "ял",
  "ся", "сь", "ю", "л",
] as const;

function stripConjugationRemnant(afterVerb: string): string {
  const trimmed = afterVerb.trim();
  if (trimmed.length === 0) return trimmed;
  for (const ending of VERB_ENDINGS) {
    const pattern = new RegExp(`^${ending}(?=\\s|$)`, "i");
    if (pattern.test(trimmed)) {
      return trimmed.slice(ending.length).trim();
    }
  }
  return trimmed;
}

function buildInteractionCommand(
  verb: InteractionVerb,
  parts: CanonicalParts,
  instrument: IntentReference | undefined,
  goal: string | undefined,
  rawText: string,
  ambiguities: readonly string[],
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
): InteractionCommand | UnsupportedIntent {
  const compound = findCanonicalStem(afterVerb);
  const remainder = stripConjugationRemnant(afterVerb);

  const parts: CanonicalParts =
    verb === "give"
      ? splitGiveTargets(remainder)
      : (() => {
          const target = canonicalTarget(remainder);
          return verb === "listen" && isAmbientListenTarget(target) ? {} : target ? { target } : {};
        })();

  const ambiguities: string[] = [];
  if (!parts.target) {
    ambiguities.push(verb === "give" ? "give without an item" : "no clear target identified");
  }
  if (verb === "give" && parts.target && !parts.secondaryTarget) {
    ambiguities.push("give without a recipient");
  }

  const command = buildInteractionCommand(verb, parts, context.instrument, context.goal, context.rawText, ambiguities);

  if (compound) {
    return {
      type: "UnsupportedButUnderstood",
      intent: command,
      message: "Одна команда — одно намерение.",
    };
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

  const verb = findBestVerb(text);

  if (!verb) {
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

  const afterVerb = removeVerb(text, verb.verb);

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

  const target = extractTarget(afterVerb);

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
  if (instrument) confidence += 0.05;
  if (goal) confidence += 0.05;
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
    instrument,
    goal,
    manner: undefined,
    utterance: finalUtterance,
    rawText,
    interpretation: { source: "deterministic", confidence, ambiguities },
  };
}
