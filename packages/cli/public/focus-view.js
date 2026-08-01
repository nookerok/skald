// focus-view.js — renders the moment-of-return focus strictly from the
// backend PresenceFocus. Blocks that are null (e.g. timeDescription, which
// has no World Clock law yet) are skipped; nothing is invented. The single
// interactive element is the «Я здесь» acknowledge button.

export function renderFocusView(session) {
  const fragment = document.createDocumentFragment();
  const focus = session.presence && session.presence.focus;
  if (!focus) return fragment;

  const section = document.createElement("section");
  section.className = "presence-focus";
  section.setAttribute("aria-label", "Момент возвращения");

  const heading = document.createElement("h3");
  heading.className = "presence-focus-heading";
  heading.textContent = "Момент возвращения";
  section.appendChild(heading);

  if (focus.ambientDescription) {
    const ambient = document.createElement("p");
    ambient.className = "presence-focus-ambient";
    ambient.textContent = focus.ambientDescription;
    section.appendChild(ambient);
  }

  if (focus.sensoryCues && focus.sensoryCues.length > 0) {
    const cues = document.createElement("ul");
    cues.className = "presence-focus-cues";
    for (const cue of focus.sensoryCues) {
      const item = document.createElement("li");
      item.textContent = cue;
      cues.appendChild(item);
    }
    section.appendChild(cues);
  }

  if (focus.rememberedContext && focus.rememberedContext.length > 0) {
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
