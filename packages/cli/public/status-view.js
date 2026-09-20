import { APP, CMD, JOURNAL } from "./client-state.js";

export function renderStatus(state) {
  const statusEl = document.getElementById("status-text");
  if (!statusEl) return;

  let text;
  let ariaLive = "polite";

  switch (state.application) {
    case APP.BOOTING:
      text = "Загрузка...";
      break;
    case APP.READY:
      switch (state.command) {
        case CMD.PENDING:
          // The composer state machine owns this status line exclusively
          // (plan_9 §8): setComposerState(SUBMITTING) writes «МАСТЕР
          // отвечает…» in the same render cycle. Do not write a second one.
          return;
        case CMD.SUCCEEDED:
          text = "Готов";
          break;
        case CMD.REJECTED:
          text = state.lastPlayerMessage || "МАСТЕР не понял этого намерения.";
          ariaLive = "assertive";
          break;
        case CMD.DUPLICATE:
          text = "Этот ход уже был принят.";
          ariaLive = "assertive";
          break;
        case CMD.TRANSPORT_FAILED:
          text = "Связь с миром прервалась. Можно повторить то же намерение.";
          ariaLive = "assertive";
          break;
        case CMD.TIMEOUT:
          text = "Ответ задерживается. Можно повторить то же намерение.";
          ariaLive = "assertive";
          break;
        default:
          text = "Готов";
      }
      break;
    case APP.DISCONNECTED:
      text = "Потеря связи с миром...";
      ariaLive = "assertive";
      break;
    case APP.RECONNECTING:
      text = "Восстанавливаем связь...";
      ariaLive = "assertive";
      break;
    case APP.FATAL:
      text = "Ошибка — перезагрузите страницу.";
      ariaLive = "assertive";
      break;
    default:
      text = "…";
  }

  statusEl.textContent = text;
  statusEl.setAttribute("aria-live", ariaLive);

  // Busy/disabled state is owned exclusively by the atomic ui-state composer
  // setter (driven by composer-state.js): this renderer owns status text
  // only, so two writers can never split the composer again.
}

export function renderJournalStatus(state) {
  const container = document.getElementById("journal-container");
  if (!container) return;

  // A populated journal is authoritative; never overlay an empty/loading status on it.
  if (container.querySelector(".turn-entry")) return;

  const existingMsg = container.querySelector(".journal-status-msg");
  if (existingMsg) existingMsg.remove();

  let text;
  switch (state.journal) {
    case JOURNAL.LOADING:
      text = "Загружаем хронику...";
      break;
    case JOURNAL.EMPTY:
      text = "Хроника пока пуста. Сделай первый ход.";
      break;
    case JOURNAL.STALE:
      text = "Хроника устарела — обновите страницу.";
      break;
    case JOURNAL.UNAVAILABLE:
      text = "Хроника недоступна.";
      break;
    default:
      return;
  }

  const msg = document.createElement("div");
  msg.className = "journal-status-msg";
  msg.style.cssText = "color:#888;font-size:0.85rem;padding:0.5rem;";
  msg.textContent = text;
  container.appendChild(msg);
}
