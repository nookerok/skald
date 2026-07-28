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
          text = "Мир отвечает...";
          ariaLive = "assertive";
          break;
        case CMD.SUCCEEDED:
          text = "Готов";
          break;
        case CMD.REJECTED:
          text = state.lastPlayerMessage || "Мир не понял этого намерения.";
          ariaLive = "assertive";
          break;
        case CMD.DUPLICATE:
          text = "Этот ход уже был принят.";
          ariaLive = "assertive";
          break;
        case CMD.TRANSPORT_FAILED:
          text = "Связь с миром прервалась. Нажми Retry.";
          ariaLive = "assertive";
          break;
        case CMD.TIMEOUT:
          text = "Мир не отвечает. Нажми Retry.";
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

  // Busy indicator on controls section
  const controls = document.getElementById("controls-section");
  if (controls) {
    const busy = state.command === CMD.PENDING || state.application === APP.BOOTING || state.application === APP.RECONNECTING;
    controls.setAttribute("aria-busy", String(busy));
    document.querySelectorAll(".dir-btn, .social-btn, #send-btn, #retry-btn, .guidance-action").forEach((el) => {
      el.disabled = busy;
    });
  }
}

export function renderJournalStatus(state) {
  const container = document.getElementById("journal-container");
  if (!container) return;

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
