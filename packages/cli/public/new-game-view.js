import { loadDraft, saveDraft, clearDraft, createWorldId, createIdempotencyKey } from "./new-game-state.js";
import { fetchObserverSession, acknowledgePresence, createRequestKey } from "./world-api-client.js";
import { savePresenceLease } from "./presence-lease.js";

let backgrounds = [];
let entrypoints = [];
let region = null;
let step = "character"; // character | entrypoint | prologue
let selectedBackgroundId = null;
let selectedEntrypointId = null;
let characterName = "";
let pendingReq = null;
let prologue = null;
let prologueKey = "";
let prologueError = "";
let prologueRequest = 0;

export async function loadNewGameOptions() {
  try {
    const response = await fetch("/api/new-game/options", { signal: AbortSignal.timeout(8000) });
    const body = await response.json();
    backgrounds = Array.isArray(body.backgrounds) ? body.backgrounds : [];
    entrypoints = Array.isArray(body.entrypoints) ? body.entrypoints : [];
    region = body.region || null;
    if (!entrypoints.some((entry) => entry.id === selectedEntrypointId)) selectedEntrypointId = entrypoints.length === 1 ? entrypoints[0].id : null;
    saveCurrentDraft();
  } catch {
    backgrounds = [];
    entrypoints = [];
    region = null;
  }
}

function migrateDraft(raw) {
  if (!raw || typeof raw !== "object") return {};
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    backgroundId: raw.backgroundId || raw.presetId || null,
    entrypointId: raw.entrypointId || null,
  };
}

export async function initNewGame() {
  const draft = migrateDraft(loadDraft());
  characterName = draft.name;
  selectedBackgroundId = draft.backgroundId;
  selectedEntrypointId = draft.entrypointId;
  pendingReq = loadPendingRequest();
  if (pendingReq) {
    characterName = pendingReq.body.characterName;
    selectedBackgroundId = pendingReq.body.backgroundId;
    selectedEntrypointId = pendingReq.body.entrypointId;
  }
  await loadNewGameOptions();
  const hash = window.location.hash;
  if (hash.includes("/new/prologue")) step = "prologue";
  else if (hash.includes("/new/entrypoint") || hash.includes("/new/world")) step = "entrypoint";
  else if (hash.includes("/new/confirm")) step = "prologue";
  else step = "character";
  renderNewGame();
  if (pendingReq?.phase === "opening_conversation") {
    const targetWorldId = pendingReq.worldId;
    clearPendingRequest();
    clearDraft();
    window.location.hash = "#/world/" + encodeURIComponent(targetWorldId);
    return;
  }
  if (pendingReq && pendingReq.phase !== "complete") resumeStoryStart();
}

export function renderNewGame() {
  const container = document.getElementById("new-game-container");
  if (!container) return;
  container.replaceChildren();
  container.className = "new-game-screen";
  container.dataset.step = step;
  container.appendChild(renderJourneyProgress(step));
  if (step === "character") renderCharacterStep(container);
  else if (step === "entrypoint") renderEntrypointStep(container);
  else renderPrologueStep(container);
}

function renderJourneyProgress(activeStep) {
  const steps = [["character", "Персонаж"], ["entrypoint", "Начало пути"], ["prologue", "Пролог"]];
  const progress = document.createElement("ol");
  progress.className = "ng-progress";
  progress.setAttribute("aria-label", "Начало новой истории");
  const activeIndex = steps.findIndex(([id]) => id === activeStep);
  for (const [id, label] of steps) {
    const index = steps.findIndex(([candidate]) => candidate === id);
    const item = document.createElement("li");
    item.className = "ng-progress-step";
    item.dataset.state = index < activeIndex ? "complete" : id === activeStep ? "active" : "pending";
    if (id === activeStep) { item.setAttribute("aria-current", "step"); }
    const number = document.createElement("span");
    number.className = "ng-progress-index";
    number.textContent = String(index + 1).padStart(2, "0");
    const text = document.createElement("span");
    text.className = "ng-progress-label";
    text.textContent = label;
    item.append(number, text);
    progress.appendChild(item);
  }
  return progress;
}

function saveCurrentDraft() {
  saveDraft({ name: characterName, backgroundId: selectedBackgroundId, entrypointId: selectedEntrypointId });
}

function renderCharacterStep(container) {
  const title = document.createElement("h2");
  title.textContent = "Кто ты?";
  container.appendChild(title);
  const question = document.createElement("p");
  question.className = "ng-question";
  question.textContent = "Назови себя и выбери прошлое, которое приведёт тебя к первой двери.";
  container.appendChild(question);
  const label = document.createElement("label");
  label.className = "ng-label";
  label.textContent = "Имя";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "ng-input";
  input.maxLength = 40;
  input.placeholder = "Как к тебе обращаться?";
  input.value = characterName;
  input.addEventListener("input", () => { characterName = input.value.trim(); prologue = null; prologueKey = ""; prologueError = ""; saveCurrentDraft(); updateNext(); });
  label.appendChild(input);
  container.appendChild(label);
  const cards = document.createElement("div");
  cards.className = "ng-cards";
  for (const background of backgrounds) {
    const card = document.createElement("div");
    const selected = selectedBackgroundId === background.id;
    card.className = "ng-card" + (selected ? " ng-card-selected" : "");
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-pressed", String(selected));
    const heading = document.createElement("div");
    heading.className = "ng-card-title";
    heading.textContent = background.title;
    const description = document.createElement("div");
    description.className = "ng-card-desc";
    description.textContent = background.description;
    card.append(heading, description);
    if (selected) {
      const details = document.createElement("div");
      details.className = "ng-card-traits";
      details.append(textLine("Твоё прошлое", background.history), textLine("Что ты умеешь замечать", background.startingKnowledge), textLine("Незавершённая нить", background.openingHook));
      card.appendChild(details);
    }
    const choose = () => { selectedBackgroundId = selected ? null : background.id; prologue = null; prologueKey = ""; prologueError = ""; saveCurrentDraft(); renderNewGame(); };
    card.addEventListener("click", choose);
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); } });
    cards.appendChild(card);
  }
  container.appendChild(cards);
  const nav = navigation("Назад", "Выбрать начало", () => { window.location.hash = "#/menu"; }, () => { step = "entrypoint"; window.location.hash = "#/new/entrypoint"; }, () => Boolean(characterName && selectedBackgroundId));
  container.appendChild(nav);
  function updateNext() { const button = nav.querySelector(".ng-btn-next"); if (button) button.disabled = !characterName || !selectedBackgroundId; }
}

function renderEntrypointStep(container) {
  if (!characterName || !selectedBackgroundId) { window.location.hash = "#/new/character"; return; }
  const title = document.createElement("h2");
  title.textContent = "Откуда начинается твоя история?";
  container.appendChild(title);
  const regionTitle = document.createElement("p");
  regionTitle.className = "ng-region-title";
  regionTitle.textContent = region?.title || "Бассейн Речного Стража";
  container.appendChild(regionTitle);
  const question = document.createElement("p");
  question.className = "ng-question";
  question.textContent = region?.description || "Один живой регион, в котором дорога меняется вместе с теми, кто по ней идёт.";
  container.appendChild(question);
  if (entrypoints.length === 1) {
    const note = document.createElement("p");
    note.className = "ng-entrypoint-note";
    note.textContent = "Это единственное авторски подтверждённое начало. Другие дороги откроются тебе уже в игре.";
    container.appendChild(note);
  }
  const cards = document.createElement("div");
  cards.className = "ng-cards";
  for (const entrypoint of entrypoints) {
    const card = document.createElement("div");
    const selected = selectedEntrypointId === entrypoint.id;
    card.className = "ng-card" + (selected ? " ng-card-selected" : "");
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-pressed", String(selected));
    const heading = document.createElement("div");
    heading.className = "ng-card-title";
    heading.textContent = entrypoint.title;
    const description = document.createElement("div");
    description.className = "ng-card-desc";
    description.textContent = entrypoint.description;
    const atmosphere = document.createElement("div");
    atmosphere.className = "ng-card-question";
    atmosphere.textContent = entrypoint.atmosphere;
    card.append(heading, description, atmosphere);
    const choose = () => {
      // A single authored start is a confirmation, not a toggleable choice.
      // Keep it selected so the player cannot accidentally create an empty
      // entrypoint selection while the Canon still exposes only one start.
      selectedEntrypointId = entrypoints.length === 1 ? entrypoint.id : (selected ? null : entrypoint.id);
      prologue = null;
      prologueKey = "";
      prologueError = "";
      saveCurrentDraft();
      renderNewGame();
    };
    card.addEventListener("click", choose);
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); } });
    cards.appendChild(card);
  }
  container.appendChild(cards);
  container.appendChild(navigation("Назад", "Увидеть пролог", () => { step = "character"; window.location.hash = "#/new/character"; }, () => { step = "prologue"; window.location.hash = "#/new/prologue"; }, () => Boolean(selectedEntrypointId)));
}

function renderPrologueStep(container) {
  const background = backgrounds.find((item) => item.id === selectedBackgroundId);
  const entrypoint = entrypoints.find((item) => item.id === selectedEntrypointId);
  if (!characterName || !background || !entrypoint) { window.location.hash = "#/new/character"; return; }
  const key = `${characterName}|${background.id}|${entrypoint.id}`;
  const title = document.createElement("h2");
  title.textContent = "Пролог";
  container.appendChild(title);
  if (prologueKey !== key && !prologueError) {
    const loading = document.createElement("p");
    loading.className = "ng-pending";
    loading.setAttribute("role", "status");
    loading.textContent = "Собираем начало твоей истории…";
    container.appendChild(loading);
    void requestPrologue(key, background.id, entrypoint.id);
    container.appendChild(navigation("Изменить начало", "Начать путь", () => { step = "entrypoint"; window.location.hash = "#/new/entrypoint"; }, beginStory, () => false));
    return;
  }
  if (prologueError) {
    const error = document.createElement("p");
    error.className = "ng-error";
    error.setAttribute("role", "alert");
    error.textContent = prologueError;
    container.appendChild(error);
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "ng-btn ng-btn-next";
    retry.textContent = "Повторить";
    retry.addEventListener("click", () => { prologueError = ""; renderNewGame(); });
    container.appendChild(retry);
    return;
  }
  const scene = document.createElement("article");
  scene.className = "ng-prologue";
  const location = document.createElement("p");
  location.className = "ng-prologue-location";
  location.textContent = `${prologue.locationTitle} · ${region?.title || "Бассейн Речного Стража"}`;
  scene.appendChild(location);
  for (const paragraph of prologue.paragraphs) { const node = document.createElement("p"); node.textContent = paragraph; scene.appendChild(node); }
  const reminder = document.createElement("p");
  reminder.className = "ng-prologue-hook";
  reminder.textContent = `${prologue.backgroundReminder} ${prologue.openingHook}`;
  scene.appendChild(reminder);
  container.appendChild(scene);
  const nav = navigation("Изменить начало", "Начать путь", () => { step = "entrypoint"; window.location.hash = "#/new/entrypoint"; }, beginStory, () => !pendingReq && Boolean(prologue));
  container.appendChild(nav);
  if (pendingReq && pendingReq.phase !== "complete") {
    const status = document.createElement("p");
    status.className = "ng-pending";
    status.setAttribute("role", "status");
    status.textContent = pendingReq.phase === "failed" ? "Начало не открылось. Попробуй ещё раз." : "Открываем путь…";
    container.appendChild(status);
  }
}

async function requestPrologue(key, backgroundId, entrypointId) {
  const requestId = ++prologueRequest;
  try {
    const response = await fetch("/api/new-game/prologue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterName, backgroundId, entrypointId }), signal: AbortSignal.timeout(8000) });
    const result = await response.json();
    if (!result.ok || !result.prologue) throw new Error(result.error?.message || "Не удалось открыть пролог.");
    if (requestId !== prologueRequest) return;
    prologue = result.prologue;
    prologueKey = key;
    prologueError = "";
    renderNewGame();
  } catch (error) {
    if (requestId !== prologueRequest) return;
    prologueError = error instanceof Error ? error.message : "Не удалось открыть пролог.";
    renderNewGame();
  }
}

function textLine(label, value) {
  const line = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = label + ": ";
  line.append(strong, document.createTextNode(value));
  return line;
}

function navigation(backText, nextText, onBack, onNext, enabled) {
  const nav = document.createElement("div");
  nav.className = "ng-nav";
  const back = document.createElement("button");
  back.className = "ng-btn ng-btn-back";
  back.type = "button";
  back.textContent = backText;
  back.addEventListener("click", onBack);
  const next = document.createElement("button");
  next.className = "ng-btn ng-btn-next ng-btn-create";
  next.type = "button";
  next.textContent = nextText;
  next.disabled = !enabled();
  next.addEventListener("click", () => { if (!next.disabled) onNext(); });
  nav.append(back, next);
  return nav;
}

function loadPendingRequest() {
  try {
    const raw = sessionStorage.getItem("skald:new-game:pending");
    const request = raw ? JSON.parse(raw) : null;
    return request?.worldId && request?.idempotencyKey && request?.body ? request : null;
  } catch { return null; }
}

function savePendingRequest(request) {
  try { sessionStorage.setItem("skald:new-game:pending", JSON.stringify(request)); } catch {}
}

function clearPendingRequest() {
  try { sessionStorage.removeItem("skald:new-game:pending"); } catch {}
}

function beginStory() {
  if (pendingReq) { resumeStoryStart(); return; }
  const body = { worldId: createWorldId(), idempotencyKey: createIdempotencyKey(), characterName, backgroundId: selectedBackgroundId, entrypointId: selectedEntrypointId };
  pendingReq = { worldId: body.worldId, idempotencyKey: body.idempotencyKey, body, phase: "creating_story" };
  savePendingRequest(pendingReq);
  resumeStoryStart();
}

async function resumeStoryStart() {
  if (!pendingReq || pendingReq.phase === "complete" || pendingReq.running) return;
  pendingReq.running = true;
  savePendingRequest(pendingReq);
  renderNewGame();
  try {
    if (pendingReq.phase === "creating_story" || pendingReq.phase === "failed") {
      pendingReq.phase = "creating_story";
      const response = await fetch("/api/worlds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pendingReq.body), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error?.message || "story creation failed");
      pendingReq.worldId = result.world?.worldId || pendingReq.worldId;
      pendingReq.phase = "loading_first_presence";
      delete pendingReq.running;
      savePendingRequest(pendingReq);
    }
    const sessionResult = await fetchObserverSession(pendingReq.worldId);
    if (!sessionResult.body?.ok || !sessionResult.body.session?.revision) throw new Error("Не удалось открыть начало истории.");
    pendingReq.revision = sessionResult.body.session.revision;
    pendingReq.phase = "acknowledging_first_presence";
    pendingReq.presenceKey = pendingReq.presenceKey || createRequestKey("presence-ack");
    delete pendingReq.running;
    savePendingRequest(pendingReq);
    renderNewGame();
    const ack = await acknowledgePresence(pendingReq.worldId, pendingReq.presenceKey, pendingReq.revision.worldTime, pendingReq.revision.eventNumber);
    if (!ack.body?.ok) {
      if (ack.status === 409 && ack.body?.error?.code === "stale_revision") { pendingReq.presenceKey = createRequestKey("presence-ack"); pendingReq.phase = "loading_first_presence"; savePendingRequest(pendingReq); return resumeStoryStart(); }
      throw new Error(ack.body?.error?.message || "Не удалось подтвердить начало.");
    }
    savePresenceLease(pendingReq.worldId, pendingReq.revision);
    pendingReq.phase = "opening_conversation";
    delete pendingReq.running;
    savePendingRequest(pendingReq);
    const targetWorldId = pendingReq.worldId;
    window.location.hash = "#/world/" + encodeURIComponent(pendingReq.worldId);
    void targetWorldId;
    clearPendingRequest();
    clearDraft();
  } catch (error) {
    if (pendingReq) { delete pendingReq.running; pendingReq.phase = "failed"; pendingReq.error = error instanceof Error ? error.message : "Не удалось открыть начало истории."; savePendingRequest(pendingReq); renderNewGame(); }
  }
}
