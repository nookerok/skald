export function renderGameShell(snapshot) {
  if (!snapshot) return;
  setText("active-world-label", snapshot.worldId || "Мир");
  setText("time-display", `Ход ${snapshot.revision?.worldTime ?? 0}`);
  const pos = snapshot.world?.position || { x: 0, y: 0 };
  setText("pos-display", `${pos.x}, ${pos.y}`);
  setText("attention-level", snapshot.attention?.explanation || "Мир спокоен");
  renderWorld(snapshot.world, snapshot.attention);
  renderPrimary(snapshot.lastTurn);
  renderSituation(snapshot.currentSituation);
  renderActivity(snapshot.recentActivity || []);
  renderKnowledge(snapshot.knowledge || {});
  renderCharacter(snapshot.character || {});
  renderTimeline(snapshot.lastTurn?.causalChain || []);
}

function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value == null ? "" : String(value); }
function node(tag, text, cls) { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }
function renderPrimary(turn) {
  const card = document.getElementById("primary-card"); if (!card) return; card.replaceChildren();
  const primary = turn?.primary;
  const empty = document.getElementById("empty-state");
  if (!primary) { card.hidden = true; if (empty) empty.hidden = false; card.append(node("div", "Мир ждёт твоего следующего шага", "empty-card")); return; }
  if (empty) empty.hidden = true; card.hidden = false;
  card.append(node("div", primary.text || "", "primary-title"));
  if (primary.discoveryMark) card.append(node("span", primary.discoveryMark, "discovery-mark"));
  const notable = document.getElementById("notable-list"); if (notable) { notable.replaceChildren(...(turn.notable || []).map(e => node("div", e.text, "notable-item"))); }
  const background = document.getElementById("background-list"); if (background) { background.replaceChildren(...(turn.background || []).slice(0, 5).map(e => node("div", e.text, "background-item"))); }
}
function renderWorld(world, attention) { const el = document.getElementById("context-world"); if (!el) return; el.replaceChildren(node("h3", "Мир"), node("p", `Координаты: ${world?.position?.x ?? 0}, ${world?.position?.y ?? 0}`), node("p", `Тепло: ${world?.heatDescription || "спокойно"}`), node("h3", "Внимание мира"), node("p", `${attention?.level || "calm"} · ${attention?.marks ?? 0}/${attention?.maxMarks ?? 5}`), node("p", attention?.explanation || "")); }
function renderSituation(situation) { const el = document.getElementById("situation-card"); if (!el) return; el.replaceChildren(); if (!situation) return; el.append(node("strong", situation.title || "Ситуация"), node("p", situation.description || "")); }
function renderActivity(items) { const el = document.getElementById("world-activity-list"); if (!el) return; el.replaceChildren(...items.slice(0, 8).map(item => node("li", item.text || item.label || "", `activity-item ${item.scope || ""}`))); }
function renderTimeline(steps) { const el = document.getElementById("causal-timeline"); if (!el) return; const list = el.querySelector("ol") || el; list.replaceChildren(...steps.slice(0, 6).map(step => node("li", step.text || step.kind || "", "timeline-step"))); }
function renderCharacter(character) { const el = document.getElementById("context-character"); if (!el) return; el.replaceChildren(node("h3", character.displayName || "Странник"), node("p", `Рана: ${character.wound || "—"}`), node("p", `Обещание: ${character.promise || "—"}`), node("p", `Принцип: ${character.principle || "—"}`)); }
function renderKnowledge(knowledge) { const el = document.getElementById("context-knowledge"); if (!el) return; el.replaceChildren(); for (const [label, values] of [["Факты", knowledge.facts], ["Гипотезы", knowledge.hypotheses], ["Следы", knowledge.traces]]) { el.append(node("h3", label)); const ul = node("ul"); ul.append(...(values || []).slice(0, 8).map(v => node("li", typeof v === "string" ? v : (v.text || v.label || "")))); el.append(ul); } }
export function renderShellConnection(mode, message) { const dot = document.getElementById("connection-dot"); if (dot) dot.dataset.mode = mode || "ready"; setText("status-text", message || "Готов"); }
export function setShellBusy(busy, stage = "Мир отвечает…") { document.body.classList.toggle("shell-busy", busy); const el = document.getElementById("loading-stage"); if (el) el.textContent = stage; const form = document.getElementById("command-form"); if (form) form.setAttribute("aria-busy", String(busy)); }
export function showShellError(message) { const el = document.getElementById("shell-error"); if (el) { el.hidden = false; setText("shell-error-message", message || "Не удалось подключиться к миру"); } }
export function clearShellError() { const el = document.getElementById("shell-error"); if (el) el.hidden = true; }
export function openShellOverlay(id) { const el = document.getElementById(id); if (el) { el.hidden = false; el.querySelector("button, [tabindex]")?.focus(); } }
export function closeShellOverlay(id) { const el = document.getElementById(id); if (el) el.hidden = true; }
export function initShellView(onCommand) {
  document.querySelectorAll(".context-tab").forEach(tab => tab.addEventListener("click", () => { document.querySelectorAll(".context-tab").forEach(t => t.setAttribute("aria-selected", String(t === tab))); document.querySelectorAll(".context-panel").forEach(p => p.hidden = p.id !== `context-${tab.dataset.context}`); }));
  document.getElementById("command-form")?.addEventListener("submit", e => { e.preventDefault(); const input = document.getElementById("command-input"); if (input?.value.trim()) { onCommand(input.value.trim()); input.value = ""; } });
  document.querySelectorAll("[data-overlay-open]").forEach(b => b.addEventListener("click", () => openShellOverlay(b.dataset.overlayOpen)));
  document.querySelectorAll("[data-close-overlay]").forEach(b => b.addEventListener("click", () => closeShellOverlay(b.dataset.closeOverlay)));
  document.querySelectorAll("[data-mobile-target]").forEach(b => b.addEventListener("click", () => document.getElementById(b.dataset.mobileTarget)?.scrollIntoView({ behavior: "smooth", block: "start" })));
  document.getElementById("shell-retry-connect")?.addEventListener("click", () => window.dispatchEvent(new CustomEvent("skald:retry-connect")));
}
