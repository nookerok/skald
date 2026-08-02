// threads-view.js — renders the "Активные нити" panel strictly from the
// backend ObserverThreadJournalDTO. The browser never classifies: lifecycle,
// certainty, importance and change kinds are computed on the server; this
// module only maps DTO values to honest player-facing text. Cards carry no
// command chips and no buttons — the only allowed interaction is
// re-observation, stated neutrally.
import { makeNode, emptyState } from "./dom-helpers.js";

const EMPTY_TEXT = "Пока ты не заметил процессов, которые продолжаются во времени.";

const CHANGE_TAGS = {
  appeared: "Новая нить",
  developed: "Изменилось",
  resolved: "Завершилось",
  contradicted: "Требует проверки",
};

const LIFECYCLE_LABELS = {
  active: "Действует",
  resolved: "Завершилось",
  unknown: "Неизвестно",
};

const STATE_LABELS = {
  observed: "Наблюдается",
  remembered: "Помнится",
  uncertain: "Эта нить требует нового наблюдения.",
  contradicted: "Есть противоречие",
};

export function threadChangeTag(kind) {
  return (kind && CHANGE_TAGS[kind]) || null;
}

export function threadLifecycleLabel(lifecycle) {
  return LIFECYCLE_LABELS[lifecycle] || "Неизвестно";
}

export function threadStateLabel(knowledgeState) {
  return STATE_LABELS[knowledgeState] || "Неизвестно";
}

function renderEvidence(entries) {
  const list = makeNode("ul", { className: "thread-evidence" });
  if (!entries || !entries.length) return list;
  for (const entry of entries) {
    const item = makeNode("li", { className: "thread-evidence-entry" });
    item.append(
      makeNode("span", { className: "thread-evidence-time", text: "Ход " + entry.worldTime }),
      makeNode("span", { className: "thread-evidence-text", text: entry.text }),
    );
    list.appendChild(item);
  }
  return list;
}

function renderThreadCard(thread) {
  const card = makeNode("article", { className: "thread-card" });
  const head = makeNode("div", { className: "thread-card-head" });
  head.appendChild(makeNode("strong", { className: "thread-card-title", text: thread.title || "Нить" }));
  const tag = threadChangeTag(thread.changeSincePresence && thread.changeSincePresence.kind);
  if (tag) head.appendChild(makeNode("span", { className: "thread-tag", text: tag }));
  card.appendChild(head);

  const meta = makeNode("div", { className: "thread-meta" });
  meta.append(
    makeNode("span", { className: "thread-state-label", text: threadLifecycleLabel(thread.knownLifecycle) }),
    makeNode("span", { className: "thread-state-dot", attrs: { "aria-hidden": "true" } }),
    makeNode("span", { className: "thread-state-label", text: threadStateLabel(thread.knowledgeState) }),
  );
  card.appendChild(meta);

  if (thread.summary) card.appendChild(makeNode("p", { className: "thread-summary", text: thread.summary }));
  if (thread.uncertaintyText) card.appendChild(makeNode("p", { className: "thread-uncertain", text: thread.uncertaintyText }));

  const observed = makeNode("p", { className: "thread-last-observed", text: "Последнее наблюдение: ход " + (thread.lastObservedAt ?? 0) });
  card.appendChild(observed);
  card.appendChild(renderEvidence(thread.evidence));
  return card;
}

export function renderThreadsPanel(container, journal) {
  if (!container) return;
  container.replaceChildren();
  if (!journal || !journal.schemaVersion || !Array.isArray(journal.threads)) {
    container.appendChild(emptyState(EMPTY_TEXT, "threads-empty"));
    return;
  }
  const list = makeNode("div", { className: "threads-list" });
  for (const thread of journal.threads) list.appendChild(renderThreadCard(thread));
  container.appendChild(list);
  if (!journal.threads.length) container.appendChild(emptyState(EMPTY_TEXT, "threads-empty"));
}
