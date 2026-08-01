// known-worlds-view.js — orchestrates the Known Worlds screen: the worlds
// list plus lazy, concurrency-limited presence summaries. Each card fetches
// its own /presence read; one failure degrades only that card.

import { fetchWorlds, fetchPresenceSummary } from "./world-api-client.js";
import { renderPresenceCard, cardStateFor, CARD_STATE_LOADING, CARD_STATE_CORRUPT } from "./presence-card-view.js";

export const PARALLEL_PRESENCE_FETCHES = 3;
const SECTION_LABEL = "Известные миры";
const EMPTY_HINT = "Мир ждёт своего наблюдателя. Открой новый мир и оставь первый след.";

export async function loadKnownWorlds(container) {
  const worlds = await fetchWorlds();
  const section = renderKnownWorlds(container, worlds);
  const cards = worlds
    .filter((world) => world.worldId)
    .map((world) => ({ world, card: renderPresenceCard(world, CARD_STATE_LOADING, null) }));
  for (const entry of cards) section.appendChild(entry.card);
  await fillPresenceSummaries(cards);
  return worlds;
}

export function renderKnownWorlds(container, worlds) {
  const section = document.createElement("section");
  section.className = "known-worlds";
  section.setAttribute("aria-label", SECTION_LABEL);

  const heading = document.createElement("h2");
  heading.className = "known-worlds-heading";
  heading.textContent = SECTION_LABEL;
  section.appendChild(heading);

  if (worlds.length === 0) {
    const hint = document.createElement("p");
    hint.className = "known-worlds-empty";
    hint.textContent = EMPTY_HINT;
    section.appendChild(hint);
  }

  container.appendChild(section);
  return section;
}

export async function fillPresenceSummaries(cards) {
  const fetchable = cards.filter((entry) => cardStateFor(entry.world, null) !== CARD_STATE_CORRUPT);
  for (let offset = 0; offset < fetchable.length; offset += PARALLEL_PRESENCE_FETCHES) {
    const batch = fetchable.slice(offset, offset + PARALLEL_PRESENCE_FETCHES);
    await Promise.all(batch.map((entry) => fetchOne(entry)));
  }
}

async function fetchOne(entry) {
  const summary = await fetchPresenceSummary(entry.world.worldId);
  const state = cardStateFor(entry.world, summary);
  const updated = renderPresenceCard(entry.world, state, summary);
  entry.card.replaceWith(updated);
  entry.card = updated;
}
