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

/** Remember the player's typed intention for this session. Returns the entry. */
export function addLocalIntent(text) {
  const intent = { worldTime: null, text: String(text) };
  localIntents.push(intent);
  return intent;
}

/** Attach the accepted intent to the world tick that answered it. */
export function bindIntentWorldTime(intent, worldTime) {
  if (intent && typeof worldTime === "number" && Number.isFinite(worldTime)) {
    intent.worldTime = worldTime;
  }
}

export function getLocalIntents() {
  return localIntents.slice();
}

/** Drop the session intents (world switch, reconnect). */
export function clearLocalIntents() {
  localIntents.length = 0;
}

function markLabel(mark) {
  return mark === "trace" ? "След" : mark === "omen" ? "Знамение" : mark === "echo" ? "Эхо" : "";
}

function intentNode(intent, pending) {
  const node = makeNode("article", { className: "chat-intent" + (pending ? " is-pending" : "") });
  node.append(
    makeNode("span", { className: "chat-intent-label", text: "ТЫ" }),
    makeNode("p", { className: "chat-intent-text", text: intent.text }),
  );
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

export function renderChatFeed(turns, intents = []) {
  const feed = byId("chat-feed");
  if (!feed) return;
  feed.replaceChildren();
  const turnList = (Array.isArray(turns) ? turns : []).slice(-MAX_TURNS);
  const intentList = Array.isArray(intents) ? intents : [];
  const children = [];
  for (const turn of turnList) {
    for (const intent of intentList.filter((item) => item.worldTime === turn.worldTime)) {
      children.push(intentNode(intent, false));
    }
    children.push(turnNode(turn));
  }
  // Intents without a journal turn yet (pending answer, rejected command or a
  // turn outside the visible window) stay visible at the end of the feed.
  for (const intent of intentList.filter((item) => !turnList.some((turn) => turn.worldTime === item.worldTime))) {
    children.push(intentNode(intent, true));
  }
  if (!children.length) {
    feed.appendChild(makeNode("p", { className: "chat-empty", text: "Мир ждёт твоего действия." }));
    return;
  }
  feed.append(...children);
  if (typeof feed.scrollHeight === "number") feed.scrollTop = feed.scrollHeight;
}
