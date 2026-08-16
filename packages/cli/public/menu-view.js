import { fetchContinue, setCurrentWorld } from "./world-api-client.js";
import { loadKnownWorlds } from "./known-worlds-view.js";

export async function loadMenu() {
  const container = document.getElementById("menu-container");
  if (!container) return;
  container.replaceChildren();
  container.className = "menu-screen";

  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow menu-eyebrow";
  eyebrow.textContent = "LIVING WORLD";
  container.appendChild(eyebrow);

  const logo = document.createElement("h1");
  logo.className = "menu-logo";
  logo.textContent = "SKALD";
  container.appendChild(logo);

  const region = document.createElement("p");
  region.className = "menu-region";
  region.textContent = "Бассейн Речного Стража";
  container.appendChild(region);

  const tagline = document.createElement("p");
  tagline.className = "menu-tagline";
  tagline.textContent = "Мир помнит твои поступки.";
  container.appendChild(tagline);

  // Continue button
  const activeWorldId = await fetchContinue();
  if (activeWorldId) {
    const continueBtn = document.createElement("button");
    continueBtn.className = "menu-primary-btn";
    continueBtn.textContent = "Продолжить";
    continueBtn.addEventListener("click", () => {
      setCurrentWorld(activeWorldId);
      navigateToWorld(activeWorldId);
    });
    container.appendChild(continueBtn);
  }

  // New world button
  const newWorldBtn = document.createElement("button");
  newWorldBtn.className = "menu-secondary-btn";
  newWorldBtn.textContent = "Начать новую историю";
  newWorldBtn.addEventListener("click", () => { window.location.hash = "#/new/character"; });
  container.appendChild(newWorldBtn);

  // Known worlds with lazy presence cards
  await loadKnownWorlds(container);

  // Footer
  const footer = document.createElement("div");
  footer.className = "menu-footer";
  const settings = document.createElement("span");
  settings.textContent = "Настройки";
  const about = document.createElement("span");
  about.textContent = "О проекте";
  footer.append(settings, about);
  container.appendChild(footer);
}

function navigateToWorld(worldId) {
  window.location.hash = "#/world/" + worldId + "/return";
}
