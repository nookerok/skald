// focus-view.js — renders the moment-of-return focus strictly from the
// backend PresenceSnapshot: observer-scoped location context, ambient
// description, sensory cues and remembered context. Blocks that are null
// (e.g. timeDescription, which has no World Clock law yet) are skipped;
// nothing is invented. The single interactive element is the «Я здесь»
// acknowledge button.

export function renderFocusView(session) {
  const fragment = document.createDocumentFragment();
  const presence = session.presence;
  if (!presence) return fragment;
  const focus = presence.focus;

  const section = document.createElement("section");
  section.className = "presence-focus";
  section.setAttribute("aria-label", "Момент возвращения");

  const heading = document.createElement("h2");
  heading.className = "presence-focus-heading";
  heading.id = "focus-phase-title";
  heading.setAttribute("data-phase-title", "true");
  heading.tabIndex = -1;
  heading.textContent = "Ты здесь";
  section.appendChild(heading);

  const location = presence.location || {};
  if (location.title || location.description) {
    const place = document.createElement("div");
    place.className = "presence-focus-place";
    if (location.title) {
      const placeTitle = document.createElement("p");
      placeTitle.className = "presence-focus-place-title";
      placeTitle.textContent = location.title;
      place.appendChild(placeTitle);
    }
    if (location.description) {
      const placeDesc = document.createElement("p");
      placeDesc.className = "presence-focus-place-description";
      placeDesc.textContent = location.description;
      place.appendChild(placeDesc);
    }
    section.appendChild(place);
  }

  if (focus && focus.ambientDescription) {
    const ambient = document.createElement("p");
    ambient.className = "presence-focus-ambient";
    ambient.textContent = focus.ambientDescription;
    section.appendChild(ambient);
  }

  if (focus && focus.sensoryCues && focus.sensoryCues.length > 0) {
    const cues = document.createElement("ul");
    cues.className = "presence-focus-cues";
    for (const cue of focus.sensoryCues) {
      const item = document.createElement("li");
      item.textContent = cue;
      cues.appendChild(item);
    }
    section.appendChild(cues);
  }

  if (focus && focus.rememberedContext && focus.rememberedContext.length > 0) {
    const remembered = document.createElement("p");
    remembered.className = "presence-focus-remembered";
    remembered.textContent = focus.rememberedContext.join(" ");
    section.appendChild(remembered);
  }

  const ackBtn = document.createElement("button");
  ackBtn.className = "presence-ack-btn";
  ackBtn.type = "button";
  ackBtn.textContent = "Я здесь";
  ackBtn.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("skald:presence-ack"));
  });
  section.appendChild(ackBtn);

  fragment.appendChild(section);
  return fragment;
}
