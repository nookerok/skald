import { fetchWorlds, fetchContinue, setCurrentWorld } from "./world-api-client.js";

export async function loadMenu() {
  const worlds = await fetchWorlds();
  renderMenu(worlds);
}

export function renderMenu(worlds) {
  const container = document.getElementById("menu-container");
  if (!container) return;
  container.innerHTML = "";

  const logo = document.createElement("h1");
  logo.className = "menu-logo";
  logo.textContent = "SKALD";
  container.appendChild(logo);

  const tagline = document.createElement("p");
  tagline.className = "menu-tagline";
  tagline.textContent = "Мир помнит твои поступки.";
  container.appendChild(tagline);

  // Continue button
  const active = worlds.filter((w) => w.status === "active" && w.worldId !== null);
  if (active.length > 0) {
    const continueBtn = document.createElement("button");
    continueBtn.className = "menu-primary-btn";
    continueBtn.textContent = "Продолжить";
    continueBtn.addEventListener("click", async () => {
      const worldId = await fetchContinue();
      if (worldId) {
        setCurrentWorld(worldId);
        navigateToWorld(worldId);
      }
    });
    container.appendChild(continueBtn);
  }

  // World cards
  if (worlds.length > 0) {
    const section = document.createElement("section");
    section.className = "menu-worlds";
    section.setAttribute("aria-label", "Сохранения");

    for (const world of worlds) {
      const card = document.createElement("div");
      card.className = "menu-world-card";
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "button");

      const label = document.createElement("div");
      label.className = "world-card-label";
      label.textContent = world.saveLabel || world.worldId;
      card.appendChild(label);

      const charName = document.createElement("div");
      charName.className = "world-card-char";
      charName.textContent = world.characterName || "Неизвестный странник";
      card.appendChild(charName);

      const time = document.createElement("div");
      time.className = "world-card-time";
      time.textContent = "Время мира: " + (world.worldTime || 0);
      card.appendChild(time);

      if (world.lastPlayedAt && world.lastPlayedAt > 0) {
        const lastPlay = document.createElement("div");
        lastPlay.className = "world-card-last";
        lastPlay.textContent = "Последняя игра: " + formatDate(world.lastPlayedAt);
        card.appendChild(lastPlay);
      }

      if (world.status === "corrupt") {
        const warning = document.createElement("div");
        warning.className = "world-card-warning";
        warning.textContent = "Сохранение требует восстановления из резервной копии.";
        card.appendChild(warning);
      } else {
        const openBtn = document.createElement("button");
        openBtn.className = "world-card-btn";
        openBtn.textContent = "Открыть";
        openBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          setCurrentWorld(world.worldId);
          navigateToWorld(world.worldId);
        });
        card.appendChild(openBtn);

        if (world.status === "active") {
          card.addEventListener("click", () => {
            setCurrentWorld(world.worldId);
            navigateToWorld(world.worldId);
          });
          card.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.click(); }
          });
        }
      }

      section.appendChild(card);
    }
    container.appendChild(section);
  }

  // Footer
  const footer = document.createElement("div");
  footer.className = "menu-footer";
  footer.innerHTML = "<span>Настройки</span><span>О проекте</span>";
  container.appendChild(footer);
}

function navigateToWorld(worldId) {
  window.location.hash = "#/world/" + worldId;
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString("ru-RU");
  } catch {
    return "";
  }
}
