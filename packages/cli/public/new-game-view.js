import { loadDraft, saveDraft, clearDraft, createWorldId, createIdempotencyKey } from "./new-game-state.js";

let presets = [];
let templates = [];
let step = "character"; // character | world | confirm
let selectedPresetId = null;
let selectedTemplateId = null;
let characterName = "";
let saveLabel = "";
let pendingReq = null;

export async function loadPresets() {
  try {
    const res = await fetch("/api/character-presets");
    const body = await res.json();
    presets = body.presets || [];
  } catch { presets = []; }
}

export async function loadTemplates() {
  try {
    const res = await fetch("/api/world-templates");
    const body = await res.json();
    templates = body.templates || [];
  } catch { templates = []; }
}

export async function initNewGame() {
  const draft = loadDraft();
  if (draft.name) characterName = draft.name;
  if (draft.presetId) selectedPresetId = draft.presetId;
  if (draft.templateId) selectedTemplateId = draft.templateId;
  if (draft.saveLabel) saveLabel = draft.saveLabel;

  await loadPresets();
  await loadTemplates();

  // Restore step from hash
  const hash = window.location.hash;
  if (hash.includes("/new/confirm") || hash.includes("/new/world")) {
    step = hash.includes("/new/confirm") ? "confirm" : "world";
  }

  renderNewGame();
}

export function renderNewGame() {
  const container = document.getElementById("new-game-container");
  if (!container) return;
  container.innerHTML = "";

  switch (step) {
    case "character": renderCharacterStep(container); break;
    case "world": renderWorldStep(container); break;
    case "confirm": renderConfirmStep(container); break;
  }
}

function renderCharacterStep(container) {
  const title = document.createElement("h2");
  title.textContent = "Новая игра";
  container.appendChild(title);

  const question = document.createElement("p");
  question.className = "ng-question";
  question.textContent = "Кем я войду в этот мир?";
  container.appendChild(question);

  // Name input
  const nameLabel = document.createElement("label");
  nameLabel.className = "ng-label";
  nameLabel.textContent = "Имя";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "ng-input";
  nameInput.maxLength = 40;
  nameInput.placeholder = "Введи имя персонажа";
  nameInput.value = characterName;
  nameInput.addEventListener("input", () => {
    characterName = nameInput.value.trim();
    saveDraft({ name: characterName, presetId: selectedPresetId, templateId: selectedTemplateId, saveLabel });
  });
  nameLabel.appendChild(nameInput);
  container.appendChild(nameLabel);

  // Preset cards
  const presetSection = document.createElement("div");
  presetSection.className = "ng-cards";
  for (const p of presets) {
    const card = document.createElement("div");
    card.className = "ng-card" + (selectedPresetId === p.id ? " ng-card-selected" : "");
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-pressed", String(selectedPresetId === p.id));

    card.innerHTML = '<div class="ng-card-title">' + escapeHtml(p.title) + '</div>' +
      '<div class="ng-card-desc">' + escapeHtml(p.description) + '</div>';
    if (selectedPresetId === p.id) {
      card.innerHTML += '<div class="ng-card-traits">' +
        '<p><em>' + escapeHtml(p.wound) + '</em></p>' +
        '<p><strong>Обещание:</strong> ' + escapeHtml(p.promise) + '</p>' +
        '<p><strong>Принцип:</strong> ' + escapeHtml(p.principle) + '</p></div>';
    }
    card.addEventListener("click", () => {
      selectedPresetId = selectedPresetId === p.id ? null : p.id;
      saveDraft({ name: characterName, presetId: selectedPresetId, templateId: selectedTemplateId, saveLabel });
      renderNewGame();
    });
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.click(); } });
    presetSection.appendChild(card);
  }
  container.appendChild(presetSection);

  // Navigation
  const nav = document.createElement("div");
  nav.className = "ng-nav";
  const backBtn = document.createElement("button");
  backBtn.className = "ng-btn ng-btn-back";
  backBtn.textContent = "Назад";
  backBtn.addEventListener("click", () => window.location.hash = "#/menu");
  nav.appendChild(backBtn);

  const nextBtn = document.createElement("button");
  nextBtn.className = "ng-btn ng-btn-next";
  nextBtn.textContent = "Выбрать мир";
  nextBtn.disabled = !characterName || !selectedPresetId;
  nextBtn.addEventListener("click", () => {
    if (!characterName || !selectedPresetId) return;
    step = "world";
    window.location.hash = "#/new/world";
  });
  nav.appendChild(nextBtn);
  container.appendChild(nav);
}

function renderWorldStep(container) {
  // Restore draft
  const draft = loadDraft();
  if (!draft.name || !draft.presetId) { window.location.hash = "#/new/character"; return; }
  characterName = draft.name || characterName;
  selectedPresetId = draft.presetId || selectedPresetId;

  const title = document.createElement("h2");
  title.textContent = "Выбор мира";
  container.appendChild(title);

  const question = document.createElement("p");
  question.className = "ng-question";
  question.textContent = "Какой мир я хочу исследовать?";
  container.appendChild(question);

  const cardSection = document.createElement("div");
  cardSection.className = "ng-cards";
  for (const t of templates) {
    const card = document.createElement("div");
    card.className = "ng-card" + (selectedTemplateId === t.id ? " ng-card-selected" : "");
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-pressed", String(selectedTemplateId === t.id));

    card.innerHTML = '<div class="ng-card-title">' + escapeHtml(t.title) + '</div>' +
      '<div class="ng-card-desc">' + escapeHtml(t.description) + '</div>' +
      '<div class="ng-card-question">' + escapeHtml(t.startingQuestion) + '</div>';
    card.addEventListener("click", () => {
      selectedTemplateId = selectedTemplateId === t.id ? null : t.id;
      saveDraft({ name: characterName, presetId: selectedPresetId, templateId: selectedTemplateId, saveLabel });
      renderNewGame();
    });
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.click(); } });
    cardSection.appendChild(card);
  }
  container.appendChild(cardSection);

  // Save label
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "ng-input";
  labelInput.maxLength = 80;
  labelInput.placeholder = "Название сохранения (необязательно)";
  labelInput.value = saveLabel || (characterName + " — " + (templates.find(t => t.id === selectedTemplateId)?.title || "Мир"));
  labelInput.addEventListener("input", () => {
    saveLabel = labelInput.value.trim();
    saveDraft({ name: characterName, presetId: selectedPresetId, templateId: selectedTemplateId, saveLabel });
  });
  container.appendChild(labelInput);

  const nav = document.createElement("div");
  nav.className = "ng-nav";
  const backBtn = document.createElement("button");
  backBtn.className = "ng-btn ng-btn-back";
  backBtn.textContent = "Назад";
  backBtn.addEventListener("click", () => { step = "character"; window.location.hash = "#/new/character"; });
  nav.appendChild(backBtn);

  const nextBtn = document.createElement("button");
  nextBtn.className = "ng-btn ng-btn-next";
  nextBtn.textContent = "Подтвердить";
  nextBtn.disabled = !selectedTemplateId;
  nextBtn.addEventListener("click", () => {
    if (!selectedTemplateId) return;
    step = "confirm";
    window.location.hash = "#/new/confirm";
  });
  nav.appendChild(nextBtn);
  container.appendChild(nav);
}

function renderConfirmStep(container) {
  const draft = loadDraft();
  if (!draft.name || !draft.presetId || !draft.templateId) { window.location.hash = "#/new/character"; return; }
  characterName = draft.name;
  selectedPresetId = draft.presetId;
  selectedTemplateId = draft.templateId;
  saveLabel = draft.saveLabel || (characterName + " — " + (templates.find(t => t.id === selectedTemplateId)?.title || "Мир"));

  const title = document.createElement("h2");
  title.textContent = "Подтверждение";
  container.appendChild(title);

  const info = document.createElement("div");
  info.className = "ng-confirm-info";

  const preset = presets.find(p => p.id === selectedPresetId);
  const template = templates.find(t => t.id === selectedTemplateId);

  info.innerHTML = '<p><strong>Персонаж:</strong> ' + escapeHtml(characterName) + ' (' + escapeHtml(preset?.title || "") + ')</p>' +
    '<p><strong>Мир:</strong> ' + escapeHtml(template?.title || "") + '</p>' +
    '<p><strong>Сохранение:</strong> ' + escapeHtml(saveLabel) + '</p>';
  container.appendChild(info);

  if (pendingReq && pendingReq.state === "pending") {
    const pendingMsg = document.createElement("div");
    pendingMsg.className = "ng-pending";
    pendingMsg.textContent = "Мир создаётся...";
    container.appendChild(pendingMsg);
    return;
  }

  if (pendingReq && pendingReq.state === "failed") {
    const errMsg = document.createElement("div");
    errMsg.className = "ng-error";
    errMsg.textContent = "Не удалось создать мир. Проверь соединение и попробуй снова.";
    container.appendChild(errMsg);
  }

  const nav = document.createElement("div");
  nav.className = "ng-nav";
  const backBtn = document.createElement("button");
  backBtn.className = "ng-btn ng-btn-back";
  backBtn.textContent = "Назад";
  backBtn.addEventListener("click", () => { step = "world"; window.location.hash = "#/new/world"; });
  nav.appendChild(backBtn);

  const createBtn = document.createElement("button");
  createBtn.className = "ng-btn ng-btn-create";
  createBtn.textContent = "Создать мир";
  createBtn.addEventListener("click", createWorld);
  nav.appendChild(createBtn);
  container.appendChild(nav);
}

async function createWorld() {
  const worldId = createWorldId();
  const idempotencyKey = createIdempotencyKey();
  const body = {
    worldId, idempotencyKey,
    saveLabel: saveLabel || (characterName + " — Мир"),
    characterName, characterPresetId: selectedPresetId,
    worldTemplateId: selectedTemplateId,
  };

  pendingReq = { worldId, idempotencyKey, body, state: "pending" };
  try { sessionStorage.setItem("skald:new-game:pending", JSON.stringify(pendingReq)); } catch {}
  renderNewGame();

  try {
    const res = await fetch("/api/worlds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (result.ok) {
      clearDraft();
      try { sessionStorage.removeItem("skald:new-game:pending"); } catch {}
      window.location.hash = "#/world/" + (result.world?.worldId || worldId);
    } else {
      pendingReq.state = "failed";
      renderNewGame();
    }
  } catch {
    pendingReq.state = "failed";
    renderNewGame();
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
