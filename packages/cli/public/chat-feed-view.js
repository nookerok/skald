import { byId, makeNode } from "./dom-helpers.js";

/**
 * Chronicle Feed (ADR-0024): the main Game Screen surface. Renders a vertical
 * dialogue between the player and the master from the journal DTO plus
 * temporary pending intent bubbles. DTO-only: no event types, no source IDs,
 * no command controls. Persisted ConversationTurns are the source for the
 * durable player/master exchange; local intents disappear after hydration.
 */

const MAX_TURNS = 12;
const localIntents = [];
const localClarifications = [];
const localInquiries = [];
const confirmedPairs = [];
const MAX_CONFIRMED_PAIRS = 20;

/** Remember the player's typed intention for this session. Returns the entry. */
export function addLocalInquiry(question, answer) {
  const entry = { question: String(question || ""), answer: String(answer || "") };
  localInquiries.push(entry);
  return entry;
}

export function addLocalIntent(text, requestKey) {
  const normalizedKey = typeof requestKey === "string" && requestKey ? requestKey : null;
  const existing = normalizedKey ? localIntents.find((item) => item.requestKey === normalizedKey) : null;
  if (existing) return existing;
  const intent = { worldTime: null, text: String(text) };
  if (normalizedKey) intent.requestKey = normalizedKey;
  localIntents.push(intent);
  return intent;
}

/** Attach the accepted intent to the world tick that answered it. */
export function bindIntentWorldTime(intent, worldTime) {
  if (intent && typeof worldTime === "number" && Number.isFinite(worldTime)) {
    intent.worldTime = worldTime;
  }
}

export function removeLocalIntent(intent) {
  const index = localIntents.indexOf(intent);
  if (index >= 0) localIntents.splice(index, 1);
  const clarificationIndex = localClarifications.findIndex((entry) => entry.intent === intent);
  if (clarificationIndex >= 0) localClarifications.splice(clarificationIndex, 1);
}

export function setIntentStatus(intent, status) {
  if (intent && typeof status === "string") intent.status = status;
}

export function addClarification(intent, question, options = []) {
  if (!intent) return null;
  const existing = localClarifications.find((item) => item.intent === intent);
  const entry = existing || { intent, question: "", options: [] };
  entry.question = String(question || "Мастер просит уточнить действие.");
  entry.options = Array.isArray(options) ? options.map((option) => String(option?.label || option || "")).filter(Boolean).slice(0, 3) : [];
  if (!existing) localClarifications.push(entry);
  return entry;
}

export function getLocalIntents() {
  return localIntents.slice();
}

/** Drop the session intents (world switch, reconnect). */
export function clearLocalIntents() {
  localIntents.length = 0;
  localClarifications.length = 0;
  localInquiries.length = 0;
  confirmedPairs.length = 0;
}

/**
 * Confirmed master pair (one input, one MasterTurn): the command HTTP
 * response already carries the durable ConversationTurn plus its
 * MasterTurn envelope. Store it keyed by the server-issued turnKey so the
 * ТЫ → МАСТЕР pair renders immediately — journal hydration later confirms
 * and enriches the same pair instead of creating it. A narration update
 * then replaces the content of the same logical bubble (same turnKey).
 * Returns the stored entry, or null when the pair cannot be keyed to one
 * MasterTurn (turnKey mismatch or missing turn).
 */
export function upsertConfirmedPair(conversationTurn, masterTurn) {
  if (!isConversationTurn(conversationTurn)) return null;
  const turnKey = masterTurn && typeof masterTurn.turnKey === "string" && masterTurn.turnKey ? masterTurn.turnKey : null;
  if (!turnKey || conversationTurn.turnKey !== turnKey) return null;
  const key = conversationTurn.idempotencyKey || turnKey;
  const entry = { ...conversationTurn };
  const existing = confirmedPairs.findIndex((item) => (item.idempotencyKey || turnKeyOf(item)) === key);
  if (existing >= 0) confirmedPairs[existing] = entry;
  else {
    confirmedPairs.push(entry);
    while (confirmedPairs.length > MAX_CONFIRMED_PAIRS) confirmedPairs.shift();
  }
  return entry;
}

/** Session-confirmed pairs awaiting journal hydration (oldest first). */
export function getConfirmedPairs() {
  return confirmedPairs.slice();
}

function markLabel(mark) {
  return mark === "trace" ? "След" : mark === "omen" ? "Знамение" : mark === "echo" ? "Эхо" : "";
}

/**
 * Stable player-safe bubble key (plan_9 §6-7): the server-issued turnKey
 * for conversation turns, the opaque turnHandle for journal turns. Never a
 * database id, correlation or client key.
 */
function turnKeyOf(turn) {
  const key = turn && (turn.turnKey || turn.turnHandle);
  return typeof key === "string" && key ? key : null;
}

function turnKeyAttrs(turn) {
  const key = turnKeyOf(turn);
  return key ? { "data-turn-key": key } : {};
}

function intentNode(intent, pending) {
  const status = intent.status === "accepted" ? "Ход принят" : intent.status === "clarification" ? "Нужно уточнение" : intent.status === "offline" ? "Ждёт связи" : intent.status === "failed" ? "Не отправлено" : pending ? "Мастер отвечает…" : "Твоё намерение";
  const node = makeNode("article", { className: "chat-intent" + (pending ? " is-pending" : "") });
  node.append(
    makeNode("span", { className: "chat-intent-label", text: "ТЫ" }),
    makeNode("p", { className: "chat-intent-text", text: intent.text }),
    makeNode("span", { className: "chat-intent-status", text: status }),
  );
  return node;
}

function inquiryNodes(entry) {
  const player = makeNode("article", { className: "chat-intent" });
  player.append(
    makeNode("span", { className: "chat-intent-label", text: "ТЫ" }),
    makeNode("p", { className: "chat-intent-text", text: entry.question }),
    makeNode("span", { className: "chat-intent-status", text: "Вопрос мастеру" }),
  );
  const master = makeNode("article", { className: "chat-turn chat-turn--inquiry" });
  master.append(
    makeNode("div", { className: "chat-turn-header", text: "МАСТЕР" }),
    makeNode("p", { className: "chat-world-primary", text: entry.answer }),
  );
  return [player, master];
}

function clarificationNode(entry) {
  const node = makeNode("article", { className: "chat-turn chat-turn--clarification" });
  node.append(
    makeNode("div", { className: "chat-turn-header", text: "МАСТЕР" }),
    makeNode("p", { className: "chat-world-primary", text: entry.question }),
  );
  if (entry.options.length) {
    node.appendChild(makeNode("p", { className: "chat-clarification-hint", text: "Можно уточнить так: " + entry.options.join(" · ") }));
  }
  return node;
}

function worldStateNode(snapshot) {
  const journey = snapshot?.journey && snapshot.journey.status !== "idle" ? snapshot.journey : null;
  const situation = snapshot?.currentSituation || null;
  const critical = (snapshot?.lastTurn?.causalChain || []).filter((step) => step?.critical || /Критический момент|Бросок:|Итого /.test(step?.text || ""));
  if (!journey && !situation && !critical.length) return null;
  const node = makeNode("article", { className: "chat-state" });
  if (journey) {
    const stage = journey.status === "traveling" && Number.isFinite(journey.elapsedTicks) && Number.isFinite(journey.totalTicks)
      ? " · этап " + Math.min(journey.elapsedTicks + 1, Math.max(journey.totalTicks, 1)) + " из " + Math.max(journey.totalTicks, 1)
      : "";
    node.append(makeNode("span", { className: "chat-state-label", text: "ПУТЬ" }), makeNode("p", { text: String(journey.text || "Путь продолжается.") + stage }));
  }
  if (situation) {
    node.append(makeNode("span", { className: "chat-state-label", text: "СЕЙЧАС В МИРЕ" }), makeNode("strong", { text: situation.title || "Ситуация" }), makeNode("p", { text: situation.description || "Мир переживает перемену." }));
    const effects = Array.isArray(situation.effects) ? situation.effects.slice(0, 3).map((effect) => effect?.label).filter(Boolean) : [];
    if (effects.length) node.appendChild(makeNode("p", { className: "chat-state-signals", text: effects.join(" · ") }));
  }
  if (critical.length) {
    node.append(makeNode("span", { className: "chat-state-label", text: "КРИТИЧЕСКИЙ МОМЕНТ" }));
    for (const step of critical.slice(0, 3)) node.appendChild(makeNode("p", { text: step.text || "Ставки ещё не определились." }));
  }
  return node;
}

function conversationPlayerNode(turn) {
  const player = makeNode("article", { className: "chat-intent", attrs: turnKeyAttrs(turn) });
  player.append(
    makeNode("span", { className: "chat-intent-label", text: "ТЫ" }),
    makeNode("p", { className: "chat-intent-text", text: turn.playerText }),
    makeNode("span", { className: "chat-intent-status", text: turn.inputClass === "inquiry" ? "Вопрос мастеру" : turn.inputClass === "clarification" ? "Уточнение" : "Твоё действие" }),
  );
  return player;
}

function normalizeBubbleText(value) {
  return String(value || "").toLowerCase().replace(/ё/gu, "е").replace(/[?!.,;:\-—()"«»\s]+/gu, " ").trim();
}

/**
 * One stable master bubble: when the narrated decoration says the same as
 * the deterministic outcome (equal or contained after normalization), only
 * the longer original renders. Genuine expansions keep both paragraphs.
 */
function dedupeNarratedText(responseText, narrativeText) {
  const response = String(responseText || "");
  const narrated = String(narrativeText || "");
  if (!response || !narrated) return { primary: response, narrated };
  const left = normalizeBubbleText(response);
  const right = normalizeBubbleText(narrated);
  if (!left || !right) return { primary: response, narrated };
  if (left === right || left.includes(right) || right.includes(left)) {
    return narrated.length >= response.length
      ? { primary: "", narrated }
      : { primary: response, narrated: "" };
  }
  return { primary: response, narrated };
}

function turnNode(turn, conversationTurn = null) {
  const presentation = turn.presentation || {};
  const node = makeNode("article", { className: "chat-turn", attrs: turnKeyAttrs(conversationTurn || turn) });
  const header = makeNode("div", { className: "chat-turn-header" });
  header.append(
    makeNode("span", { className: "chat-turn-speaker", text: "МАСТЕР" }),
    makeNode("span", { className: "chat-turn-meta", text: "Ход " + turn.worldTime }),
  );
  node.appendChild(header);
  const narrative = turn.narrativeLLM;
  const response = conversationTurn ? { text: conversationTurn.responseText, kind: conversationTurn.responseKind } : presentation.response || null;
  const primary = presentation.primary || null;
  const merged = dedupeNarratedText(response?.text || primary?.text || "", narrative && !narrative.usedFallback ? narrative.text || "" : "");
  // Suppressed primary stays suppressed: fall back to the presentation
  // primary only when narration added nothing either.
  const responseText = merged.primary || (merged.narrated ? "" : primary?.text || "");
  if (responseText) {
    const primaryRow = makeNode("p", { className: "chat-world-primary", text: responseText });
    const label = markLabel(primary?.discoveryMark);
    if (label) primaryRow.appendChild(makeNode("span", { className: "chat-mark", text: label }));
    node.appendChild(primaryRow);
  }
  if (merged.narrated) {
    const narratedRow = makeNode("p", { className: "chat-world-narrated", text: merged.narrated });
    if (!responseText) {
      const label = markLabel(primary?.discoveryMark);
      if (label) narratedRow.appendChild(makeNode("span", { className: "chat-mark", text: label }));
    }
    node.appendChild(narratedRow);
  }
  const narrationState = turn.narrationState;
  if (narrationState === "pending") {
    node.appendChild(makeNode("p", { className: "chat-narration-status", text: "МАСТЕР дополняет эту запись…", attrs: { role: "status", "aria-live": "polite" } }));
  }
  for (const entry of (presentation.notable || []).slice(0, 2)) {
    node.appendChild(makeNode("p", { className: "chat-notable", text: entry.text }));
  }
  const background = (presentation.background || []).slice(0, 3).map((entry) => entry.text).filter(Boolean);
  if (background.length) {
    node.appendChild(makeNode("p", { className: "chat-background", text: background.join(" · ") }));
  }
  return node;
}

function conversationOnlyMasterNode(turn) {
  const node = makeNode("article", { className: "chat-turn chat-turn--" + turn.inputClass, attrs: turnKeyAttrs(turn) });
  node.append(
    makeNode("div", { className: "chat-turn-header", text: "МАСТЕР" }),
    makeNode("p", { className: "chat-world-primary", text: turn.responseText }),
  );
  return node;
}

/**
 * Chain-level dedup (review P1): one command's slices repeat the same
 * outcome text (the paired answer echoes the first slice's primary), so
 * identical member texts collapse AFTER the whole chain assembles — never
 * inside a single element. Comparison is normalized, the first wording
 * wins. Genuinely different slice texts all survive.
 */
function dedupeChainParts(texts) {
  const seen = new Set();
  const unique = [];
  for (const text of texts) {
    const key = normalizeBubbleText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
  }
  return unique;
}

/**
 * One master bubble for a whole command chain: member primaries read in
 * time order as one answer, narration binds to the paired slice (or the
 * newest narrated slice when unpaired), notable/background merge under
 * the usual caps. The bubble key is the paired conversation turnKey when
 * present, else the shared masterTurnKey — so narration refresh replaces
 * this same logical bubble instead of adding another.
 */
function chainTurnNode(unit) {
  const turns = unit.turns;
  const paired = unit.kind === "chainPair" ? unit.member : null;
  const key = unit.kind === "chainPair" && unit.conversation ? turnKeyOf(unit.conversation) : null;
  const node = makeNode("article", {
    className: "chat-turn",
    attrs: key ? { "data-turn-key": key } : turnKeyAttrs({ turnKey: unit.key }),
  });
  const times = turns.map((turn) => turn.worldTime).filter((time) => Number.isFinite(time));
  const span = times.length > 1 && Math.min(...times) !== Math.max(...times)
    ? `Ход ${Math.min(...times)}–${Math.max(...times)}` : `Ход ${times[0] ?? "—"}`;
  const header = makeNode("div", { className: "chat-turn-header" });
  header.append(
    makeNode("span", { className: "chat-turn-speaker", text: "МАСТЕР" }),
    makeNode("span", { className: "chat-turn-meta", text: span }),
  );
  node.appendChild(header);
  const parts = turns.map((turn) => {
    const presentation = turn.presentation || {};
    const narrative = turn.narrativeLLM;
    const response = paired === turn && unit.conversation
      ? { text: unit.conversation.responseText, kind: unit.conversation.responseKind }
      : presentation.response || null;
    const primary = presentation.primary || null;
    return dedupeNarratedText(response?.text || primary?.text || "", narrative && !narrative.usedFallback ? narrative.text || "" : "");
  });
  const primaryText = dedupeChainParts(parts.map((part) => part.primary)).join(" ");
  // Suppressed primary stays suppressed: fall back to member primaries
  // only when narration added nothing either.
  const fallbackText = parts.map((part) => part.narrated).filter(Boolean).length === 0
    ? dedupeChainParts(turns.map((turn) => turn.presentation?.primary?.text).filter(Boolean)).join(" ") : "";
  const responseText = primaryText || fallbackText;
  let mark = "";
  for (const turn of turns) {
    const label = markLabel(turn.presentation?.primary?.discoveryMark);
    if (label) { mark = label; break; }
  }
  if (responseText) {
    const primaryRow = makeNode("p", { className: "chat-world-primary", text: responseText });
    if (mark) primaryRow.appendChild(makeNode("span", { className: "chat-mark", text: mark }));
    node.appendChild(primaryRow);
  }
  const narratedText = dedupeChainParts(parts.map((part) => part.narrated).filter(Boolean)).join(" ");
  if (narratedText) {
    const narratedRow = makeNode("p", { className: "chat-world-narrated", text: narratedText });
    if (!responseText && mark) narratedRow.appendChild(makeNode("span", { className: "chat-mark", text: mark }));
    node.appendChild(narratedRow);
  }
  if (turns.some((turn) => turn.narrationState === "pending")) {
    node.appendChild(makeNode("p", { className: "chat-narration-status", text: "МАСТЕР дополняет эту запись…", attrs: { role: "status", "aria-live": "polite" } }));
  }
  const notable = turns.flatMap((turn) => (turn.presentation && turn.presentation.notable) || []).slice(0, 2);
  for (const entry of notable) {
    node.appendChild(makeNode("p", { className: "chat-notable", text: entry.text }));
  }
  const background = turns.flatMap((turn) => (turn.presentation && turn.presentation.background) || []).slice(0, 3).map((entry) => entry.text).filter(Boolean);
  if (background.length) {
    node.appendChild(makeNode("p", { className: "chat-background", text: background.join(" · ") }));
  }
  return node;
}

function isConversationTurn(value) {
  return Boolean(value && typeof value === "object" && typeof value.playerText === "string" && typeof value.responseText === "string");
}

/**
 * World development with no authoring replica (plan_9 §6-7): a run of
 * consecutive autonomous journal turns collapses into one scene separator
 * instead of a row of answer bubbles. Primary and notable signals survive
 * as subdued lines (deduplicated) — reframed as world development, never
 * as an answer to a player replica. The run never pairs with a
 * conversation turn and never matches a pending intent by time.
 */
function autonomousSeparatorNode(runs) {
  const node = makeNode("article", { className: "chat-state chat-autonomous", attrs: turnKeyAttrs(runs[0]) });
  const times = runs.map((entry) => entry.worldTime).filter((time) => Number.isFinite(time));
  const span = times.length > 1 ? `Ход ${Math.min(...times)}–${Math.max(...times)}` : `Ход ${times[0] ?? "—"}`;
  node.append(
    makeNode("span", { className: "chat-state-label", text: "МИР ПРОДОЛЖАЕТСЯ" }),
    makeNode("p", { text: "Пока ты был в пути…" }),
    makeNode("span", { className: "chat-turn-meta", text: span }),
  );
  const primaries = [];
  for (const entry of runs) {
    const text = entry.presentation && entry.presentation.primary && entry.presentation.primary.text;
    if (text && !primaries.includes(text)) primaries.push(text);
    if (primaries.length >= 2) break;
  }
  for (const text of primaries) node.appendChild(makeNode("p", { className: "chat-background", text }));
  const notable = runs
    .flatMap((entry) => (entry.presentation && entry.presentation.notable) || [])
    .slice(0, 2)
    .map((entry) => entry && entry.text)
    .filter(Boolean);
  for (const text of notable) node.appendChild(makeNode("p", { className: "chat-notable", text }));
  return node;
}

/** Fold consecutive autonomous journal items into single separator units. */
function foldAutonomousRuns(items) {
  const units = [];
  for (const item of items) {
    const last = units[units.length - 1];
    if (item.kind === "journal" && item.turn && item.turn.autonomous === true
      && last && last.kind === "autonomous") {
      last.turns.push(item.turn);
    } else if (item.kind === "journal" && item.turn && item.turn.autonomous === true) {
      units.push({ kind: "autonomous", turns: [item.turn] });
    } else {
      units.push(item);
    }
  }
  return units;
}

function itemWorldTime(item) {
  if (item.kind === "conversation") return item.turn.worldTimeAfter;
  if (item.kind === "autonomous") return item.turns[item.turns.length - 1]?.worldTime;
  if (item.kind === "chain" || item.kind === "chainPair") return item.turns[item.turns.length - 1]?.worldTime;
  return item.turn?.worldTime;
}

function sortKey(item) {
  const time = item.kind === "conversation" ? item.turn.worldTimeAfter : itemWorldTime(item);
  const createdAt = item.kind === "conversation" ? item.turn.createdAt : 0;
  const turnSeq = item.kind === "conversation" ? item.turn.turnSeq : 0;
  return [Number.isFinite(time) ? time : 0, Number.isFinite(createdAt) ? createdAt : 0, Number.isFinite(turnSeq) ? turnSeq : 0];
}

/**
 * Joins one persisted conversation turn with its journal turn, if any.
 * Join key order (plan_9 §7): narrationHandle, then correlationId+time.
 * The legacy world-time fallback stays action-only: mixed/speech answers
 * must never attach to an unrelated same-time journal turn, and autonomous
 * turns never pair at all (the caller skips them before matching).
 */
function conversationMatchesTurn(candidate, journalTurn, allowTimeFallback) {
  if (candidate.inputClass !== "action" && candidate.inputClass !== "mixed" && candidate.inputClass !== "speech") return false;
  if (candidate.narrationHandle || journalTurn.narrationHandle) {
    return typeof candidate.narrationHandle === "string" && candidate.narrationHandle === journalTurn.narrationHandle;
  }
  if (typeof candidate.correlationId === "string" && typeof journalTurn.correlationId === "string") {
    return candidate.correlationId === journalTurn.correlationId && candidate.worldTimeAfter === journalTurn.worldTime;
  }
  return candidate.inputClass === "action" && allowTimeFallback && candidate.worldTimeAfter === journalTurn.worldTime;
}

export function renderChatFeed(turns, conversationTurnsOrIntents = [], pendingOrSnapshot = null, snapshotArg = null) {
  const feed = byId("chat-feed");
  if (!feed) return;
  feed.replaceChildren();
  // The four-argument form is the durable renderer contract. Keep the old
  // three-argument form for existing callers/tests while the browser hydrates.
  const newContract = arguments.length >= 4 || (Array.isArray(conversationTurnsOrIntents) && conversationTurnsOrIntents.some(isConversationTurn));
  const conversationTurns = newContract && Array.isArray(conversationTurnsOrIntents) ? conversationTurnsOrIntents.filter(isConversationTurn) : [];
  const intentList = newContract ? (Array.isArray(pendingOrSnapshot) ? pendingOrSnapshot : []) : (Array.isArray(conversationTurnsOrIntents) ? conversationTurnsOrIntents : []);
  const snapshot = newContract ? snapshotArg : (pendingOrSnapshot && !Array.isArray(pendingOrSnapshot) ? pendingOrSnapshot : null);
  const turnList = Array.isArray(turns) ? turns : [];
  // Confirmed pairs render immediately from the command response; journal
  // hydration confirms them (journal wins on conflict) instead of creating
  // the pair — so a failed journal GET never hides an accepted turn.
  const journalKeys = new Set();
  for (const turn of conversationTurns) {
    if (turn.idempotencyKey) journalKeys.add("k:" + turn.idempotencyKey);
    const key = turnKeyOf(turn);
    if (key) journalKeys.add("t:" + key);
  }
  const pendingConfirmed = confirmedPairs.filter((entry) => {
    const key = entry.idempotencyKey ? "k:" + entry.idempotencyKey : null;
    const turnKey = turnKeyOf(entry);
    return !(key && journalKeys.has(key)) && !(turnKey && journalKeys.has("t:" + turnKey));
  });
  const mergedConversationTurns = [...conversationTurns, ...pendingConfirmed];
  const seenKeys = new Set();
  const uniqueConversationTurns = mergedConversationTurns.filter((turn) => {
    if (seenKeys.has(turn.idempotencyKey)) return false;
    seenKeys.add(turn.idempotencyKey);
    return true;
  });
  const journalItems = turnList.map((turn) => ({ kind: "journal", turn }));
  // One command, one MasterTurn: adjacent journal slices sharing a
  // masterTurnKey belong to one authoring command (e.g. a journey start
  // plus its first travel tick) and render as one chain unit instead of
  // orphaning all but one slice. Autonomous turns never join a chain.
  const chainedItems = [];
  for (const item of journalItems) {
    const key = item.kind === "journal" && item.turn && item.turn.autonomous !== true
      && typeof item.turn.masterTurnKey === "string" && item.turn.masterTurnKey
      ? item.turn.masterTurnKey : null;
    const last = chainedItems[chainedItems.length - 1];
    if (key && last && last.kind === "chain" && last.key === key) last.turns.push(item.turn);
    else if (key) chainedItems.push({ kind: "chain", key, turns: [item.turn] });
    else chainedItems.push(item);
  }
  const items = [];
  const matchedConversationKeys = new Set();
  const matchChainConversation = (unit) => {
    // The paired slice usually carries the narration handle; try members
    // newest-first so narration binds to the right slice.
    const allowFallbackFor = (member) => turnList.filter((turn) => turn.worldTime === member.worldTime).length === 1
      && uniqueConversationTurns.filter((turn) => turn.inputClass === "action" && turn.worldTimeAfter === member.worldTime).length === 1;
    for (let index = unit.turns.length - 1; index >= 0; index -= 1) {
      const member = unit.turns[index];
      const conversation = uniqueConversationTurns.find((candidate) => !matchedConversationKeys.has(candidate.idempotencyKey)
        && conversationMatchesTurn(candidate, member, allowFallbackFor(member)));
      if (conversation) return { conversation, member };
    }
    return null;
  };
  for (const item of chainedItems) {
    if (item.kind === "chain") {
      const match = matchChainConversation(item);
      if (match) {
        matchedConversationKeys.add(match.conversation.idempotencyKey);
        items.push({ kind: "chainPair", key: item.key, turns: item.turns, conversation: match.conversation, member: match.member });
      } else {
        items.push(item);
      }
      continue;
    }
    // Autonomous turns never pair: no replica authored them, so no player
    // bubble may claim them — not even by world time.
    if (item.turn && item.turn.autonomous === true) {
      items.push(item);
      continue;
    }
    const allowTimeFallback = turnList.filter((turn) => turn.worldTime === item.turn.worldTime).length === 1
      && uniqueConversationTurns.filter((turn) => turn.inputClass === "action" && turn.worldTimeAfter === item.turn.worldTime).length === 1;
    const conversation = uniqueConversationTurns.find((candidate) => !matchedConversationKeys.has(candidate.idempotencyKey)
      && conversationMatchesTurn(candidate, item.turn, allowTimeFallback));
    if (conversation) {
      matchedConversationKeys.add(conversation.idempotencyKey);
      items.push({ kind: "pair", turn: item.turn, conversation });
    } else {
      items.push(item);
    }
  }
  for (const conversation of uniqueConversationTurns) {
    if (!matchedConversationKeys.has(conversation.idempotencyKey)) items.push({ kind: "conversation", turn: conversation });
  }
  const unitTime = (item) => {
    if (item.kind === "chain" || item.kind === "chainPair") return item.turns[item.turns.length - 1]?.worldTime;
    if (item.kind === "pair") return item.turn.worldTime;
    return sortKey(item)[0];
  };
  items.sort((a, b) => {
    const timeA = a.kind === "pair" ? a.turn.worldTime : a.kind === "chainPair" ? unitTime(a) : sortKey(a)[0];
    const keyA = a.kind === "pair" || a.kind === "chainPair"
      ? [timeA, a.conversation.createdAt, a.conversation.turnSeq]
      : [timeA, sortKey(a)[1], sortKey(a)[2]];
    const timeB = b.kind === "pair" ? b.turn.worldTime : b.kind === "chainPair" ? unitTime(b) : sortKey(b)[0];
    const keyB = b.kind === "pair" || b.kind === "chainPair"
      ? [timeB, b.conversation.createdAt, b.conversation.turnSeq]
      : [timeB, sortKey(b)[1], sortKey(b)[2]];
    return keyA[0] - keyB[0] || keyA[1] - keyB[1] || keyA[2] - keyB[2];
  });
  const visibleItems = foldAutonomousRuns(items).slice(-MAX_TURNS);
  const children = [];
  for (const item of visibleItems) {
    if (item.kind === "autonomous") {
      children.push(autonomousSeparatorNode(item.turns));
      continue;
    }
    const turn = item.kind === "pair" || item.kind === "journal" ? item.turn : null;
    const worldTime = item.kind === "conversation" ? item.turn.worldTimeAfter
      : item.kind === "chain" || item.kind === "chainPair" ? unitTime(item) : turn?.worldTime;
    for (const intent of intentList.filter((candidate) => !candidate.requestKey || !seenKeys.has(candidate.requestKey) && candidate.worldTime === worldTime)) {
      children.push(intentNode(intent, false));
    }
    if (item.kind === "pair") children.push(conversationPlayerNode(item.conversation), turnNode(item.turn, item.conversation));
    else if (item.kind === "chainPair") children.push(conversationPlayerNode(item.conversation), chainTurnNode(item));
    else if (item.kind === "chain") children.push(chainTurnNode(item));
    else if (item.kind === "conversation") children.push(conversationPlayerNode(item.turn), conversationOnlyMasterNode(item.turn));
    else children.push(turnNode(item.turn));
  }
  for (const inquiry of localInquiries) children.push(...inquiryNodes(inquiry));
  const stateNode = worldStateNode(snapshot);
  if (stateNode) children.push(stateNode);
  // Intents without a journal turn yet (pending answer, rejected command or a
  // turn outside the visible window) stay visible at the end of the feed.
  for (const intent of intentList.filter((item) => {
    if (item.requestKey && seenKeys.has(item.requestKey)) return false;
    return !visibleItems.some((candidate) => itemWorldTime(candidate) === item.worldTime);
  })) {
    children.push(intentNode(intent, true));
    const clarification = localClarifications.find((entry) => entry.intent === intent);
    if (clarification) children.push(clarificationNode(clarification));
  }
  if (!children.length) {
    feed.appendChild(makeNode("p", { className: "chat-empty", text: "МАСТЕР ждёт твоего решения." }));
    return;
  }
  feed.append(...children);
  if (typeof feed.scrollHeight === "number") feed.scrollTop = feed.scrollHeight;
}
