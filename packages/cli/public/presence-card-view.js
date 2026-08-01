// presence-card-view.js — renders a single Known Worlds card from the
// backend WorldPresenceCardDTO. The browser never classifies drift and never
// invents presence texts: it renders only what the server already produced.

export const CARD_STATE_LOADING = "loading";
export const CARD_STATE_AVAILABLE = "available";
export const CARD_STATE_UNAVAILABLE = "unavailable";
export const CARD_STATE_CORRUPT = "corrupt";

const LOADING_TEXT = "Загружаем присутствие…";
const UNAVAILABLE_TEXT = "Не удалось загрузить присутствие.";
const CORRUPT_TEXT = "Сохранение требует восстановления из резервной копии.";
const UNKNOWN_CHARACTER = "Неизвестный странник";

export function cardStateFor(world, summary) {
  if (world.status === "corrupt") return CARD_STATE_CORRUPT;
  if (!summary) return CARD_STATE_UNAVAILABLE;
  return CARD_STATE_AVAILABLE;
}

export function renderPresenceCard(world, state, summary) {
  const card = document.createElement("div");
  card.className = "presence-card";
  card.dataset.state = state;
  card.setAttribute("tabindex", "0");
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", world.saveLabel || world.worldId);

  const label = document.createElement("div");
  label.className = "presence-card-label";
  label.textContent = world.saveLabel || world.worldId;
  card.appendChild(label);

  const character = document.createElement("div");
  character.className = "presence-card-character";
  character.textContent = world.characterName || UNKNOWN_CHARACTER;
  card.appendChild(character);

  const statusLine = document.createElement("div");
  statusLine.className = "presence-card-status";
  if (state === CARD_STATE_LOADING) {
    statusLine.textContent = LOADING_TEXT;
  } else if (state === CARD_STATE_CORRUPT) {
    statusLine.className += " presence-card-warning";
    statusLine.textContent = CORRUPT_TEXT;
  } else if (state === CARD_STATE_UNAVAILABLE) {
    statusLine.textContent = UNAVAILABLE_TEXT;
  } else if (summary && summary.presenceStatus) {
    statusLine.textContent = summary.presenceStatus;
  }
  card.appendChild(statusLine);

  if (state === CARD_STATE_AVAILABLE && summary && summary.knowledgeStatus) {
    const doubt = document.createElement("div");
    doubt.className = "presence-card-doubt";
    doubt.textContent = summary.knowledgeStatus;
    card.appendChild(doubt);
  }

  if (state !== CARD_STATE_CORRUPT) {
    const openBtn = document.createElement("button");
    openBtn.className = "presence-card-enter-btn";
    openBtn.textContent = "Вернуться";
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent("skald:return-to-world", { detail: { worldId: world.worldId } }));
    });
    card.appendChild(openBtn);
  }

  return card;
}
