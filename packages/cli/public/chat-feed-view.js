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
}

function markLabel(mark) {
  return mark === "trace" ? "След" : mark === "omen" ? "Знамение" : mark === "echo" ? "Эхо" : "";
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
  const player = makeNode("article", { className: "chat-intent" });
  player.append(
    makeNode("span", { className: "chat-intent-label", text: "ТЫ" }),
    makeNode("p", { className: "chat-intent-text", text: turn.playerText }),
    makeNode("span", { className: "chat-intent-status", text: turn.inputClass === "inquiry" ? "Вопрос мастеру" : turn.inputClass === "clarification" ? "Уточнение" : "Твоё действие" }),
  );
  return player;
}

function turnNode(turn, conversationTurn = null) {
  const presentation = turn.presentation || {};
  const node = makeNode("article", { className: "chat-turn" });
  const header = makeNode("div", { className: "chat-turn-header" });
  header.append(
    makeNode("span", { className: "chat-turn-speaker", text: "МАСТЕР" }),
    makeNode("span", { className: "chat-turn-meta", text: "Ход " + turn.worldTime }),
  );
  node.appendChild(header);
  const narrative = turn.narrativeLLM;
  const response = conversationTurn ? { text: conversationTurn.responseText, kind: conversationTurn.responseKind } : presentation.response || null;
  const primary = presentation.primary || null;
  const responseText = response?.text || primary?.text || "";
  if (responseText) {
    const primaryRow = makeNode("p", { className: "chat-world-primary", text: responseText });
    const label = markLabel(primary?.discoveryMark);
    if (label) primaryRow.appendChild(makeNode("span", { className: "chat-mark", text: label }));
    node.appendChild(primaryRow);
  }
  if (narrative && !narrative.usedFallback && narrative.text) {
    node.appendChild(makeNode("p", { className: "chat-world-narrated", text: narrative.text }));
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
  const node = makeNode("article", { className: "chat-turn chat-turn--" + turn.inputClass });
  node.append(
    makeNode("div", { className: "chat-turn-header", text: "МАСТЕР" }),
    makeNode("p", { className: "chat-world-primary", text: turn.responseText }),
  );
  return node;
}

function isConversationTurn(value) {
  return Boolean(value && typeof value === "object" && typeof value.playerText === "string" && typeof value.responseText === "string");
}

function sortKey(item) {
  const time = item.kind === "conversation" ? item.turn.worldTimeAfter : item.turn.worldTime;
  const createdAt = item.kind === "conversation" ? item.turn.createdAt : 0;
  const turnSeq = item.kind === "conversation" ? item.turn.turnSeq : 0;
  return [Number.isFinite(time) ? time : 0, Number.isFinite(createdAt) ? createdAt : 0, Number.isFinite(turnSeq) ? turnSeq : 0];
}

function actionConversationMatches(candidate, journalTurn, allowTimeFallback) {
  if (candidate.inputClass !== "action") return false;
  if (candidate.narrationHandle || journalTurn.narrationHandle) {
    return typeof candidate.narrationHandle === "string" && candidate.narrationHandle === journalTurn.narrationHandle;
  }
  if (typeof candidate.correlationId === "string" && typeof journalTurn.correlationId === "string") {
    return candidate.correlationId === journalTurn.correlationId && candidate.worldTimeAfter === journalTurn.worldTime;
  }
  return allowTimeFallback && candidate.worldTimeAfter === journalTurn.worldTime;
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
  const seenKeys = new Set();
  const uniqueConversationTurns = conversationTurns.filter((turn) => {
    if (seenKeys.has(turn.idempotencyKey)) return false;
    seenKeys.add(turn.idempotencyKey);
    return true;
  });
  const journalItems = turnList.map((turn) => ({ kind: "journal", turn }));
  const items = [];
  const matchedConversationKeys = new Set();
  for (const item of journalItems) {
    const allowTimeFallback = turnList.filter((turn) => turn.worldTime === item.turn.worldTime).length === 1
      && uniqueConversationTurns.filter((turn) => turn.inputClass === "action" && turn.worldTimeAfter === item.turn.worldTime).length === 1;
    const conversation = uniqueConversationTurns.find((candidate) => !matchedConversationKeys.has(candidate.idempotencyKey)
      && actionConversationMatches(candidate, item.turn, allowTimeFallback));
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
  items.sort((a, b) => {
    const ka = a.kind === "pair" ? [a.turn.worldTime, a.conversation.createdAt, a.conversation.turnSeq] : sortKey(a);
    const kb = b.kind === "pair" ? [b.turn.worldTime, b.conversation.createdAt, b.conversation.turnSeq] : sortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });
  const visibleItems = items.slice(-MAX_TURNS);
  const children = [];
  for (const item of visibleItems) {
    const turn = item.kind === "pair" || item.kind === "journal" ? item.turn : null;
    const worldTime = item.kind === "conversation" ? item.turn.worldTimeAfter : turn?.worldTime;
    for (const intent of intentList.filter((candidate) => !candidate.requestKey || !seenKeys.has(candidate.requestKey) && candidate.worldTime === worldTime)) {
      children.push(intentNode(intent, false));
    }
    if (item.kind === "pair") children.push(conversationPlayerNode(item.conversation), turnNode(item.turn, item.conversation));
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
    return !visibleItems.some((candidate) => {
      const candidateTime = candidate.kind === "conversation" ? candidate.turn.worldTimeAfter : candidate.turn?.worldTime;
      return candidateTime === item.worldTime;
    });
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
