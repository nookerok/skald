import { byId, makeNode } from "./dom-helpers.js";

/**
 * Chronicle Feed (ADR-0024): the main Game Screen surface. Renders a vertical
 * dialogue between the player and the world from the journal DTO plus
 * session-scoped intent bubbles. DTO-only: no event types, no source IDs, no
 * command controls. PlayerCommand text is not a Domain Event, so intent
 * bubbles live only in this browser session (ADR-0024 point 5).
 */

const MAX_TURNS = 12;
const localIntents = [];
const localClarifications = [];

/** Remember the player's typed intention for this session. Returns the entry. */
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

function turnNode(turn) {
  const presentation = turn.presentation || {};
  const node = makeNode("article", { className: "chat-turn" });
  const header = makeNode("div", { className: "chat-turn-header" });
  header.append(
    makeNode("span", { className: "chat-turn-speaker", text: "МИР" }),
    makeNode("span", { className: "chat-turn-meta", text: "Ход " + turn.worldTime }),
  );
  node.appendChild(header);
  const narrative = turn.narrativeLLM;
  if (narrative && !narrative.usedFallback && narrative.text) {
    node.appendChild(makeNode("p", { className: "chat-world-narrated", text: narrative.text }));
  }
  const primary = presentation.primary;
  const primaryRow = makeNode("p", { className: "chat-world-primary", text: primary?.text || "Мир продолжил жить." });
  const label = markLabel(primary?.discoveryMark);
  if (label) primaryRow.appendChild(makeNode("span", { className: "chat-mark", text: label }));
  node.appendChild(primaryRow);
  for (const entry of (presentation.notable || []).slice(0, 2)) {
    node.appendChild(makeNode("p", { className: "chat-notable", text: entry.text }));
  }
  const background = (presentation.background || []).slice(0, 3).map((entry) => entry.text).filter(Boolean);
  if (background.length) {
    node.appendChild(makeNode("p", { className: "chat-background", text: background.join(" · ") }));
  }
  return node;
}

export function renderChatFeed(turns, intents = [], snapshot = null) {
  const feed = byId("chat-feed");
  if (!feed) return;
  feed.replaceChildren();
  // Journal HTTP pages are newest-first; keep the newest window and render it oldest-to-newest.
  const turnList = (Array.isArray(turns) ? turns : []).slice(0, MAX_TURNS).reverse();
  const intentList = Array.isArray(intents) ? intents : [];
  const children = [];
  for (const turn of turnList) {
    for (const intent of intentList.filter((item) => item.worldTime === turn.worldTime)) {
      children.push(intentNode(intent, false));
    }
    children.push(turnNode(turn));
  }
  const stateNode = worldStateNode(snapshot);
  if (stateNode) children.push(stateNode);
  // Intents without a journal turn yet (pending answer, rejected command or a
  // turn outside the visible window) stay visible at the end of the feed.
  for (const intent of intentList.filter((item) => !turnList.some((turn) => turn.worldTime === item.worldTime))) {
    children.push(intentNode(intent, true));
    const clarification = localClarifications.find((entry) => entry.intent === intent);
    if (clarification) children.push(clarificationNode(clarification));
  }
  if (!children.length) {
    feed.appendChild(makeNode("p", { className: "chat-empty", text: "Мир ждёт твоего действия." }));
    return;
  }
  feed.append(...children);
  if (typeof feed.scrollHeight === "number") feed.scrollTop = feed.scrollHeight;
}
