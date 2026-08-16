import type { CharacterBackground, CharacterPreset } from "./types.js";

const _backgrounds: Record<string, CharacterBackground> = {
  wanderer: {
    id: "wanderer",
    title: "Изгнанник с северной дороги",
    shortDescription: "Бывший дорожный проводник, лишённый права вернуться домой.",
    formerRole: "Ты водил людей и грузы по северной дороге и знал её знаки лучше, чем имена попутчиков.",
    rupture: "После изгнания дорога осталась единственным местом, которое ты мог назвать своим.",
    reasonInRegion: "Ты пришёл к переправе по следу неверно установленного дорожного знака.",
    knownConnection: "Ты знаешь перевозчика у переправы и умеешь читать дорогу до Речного Стража.",
    obligation: "Найти того, кто изменил знак, и понять, кого он должен был привести сюда.",
    description: "Бывший дорожный проводник, несущий след изгнания и память о северной дороге.",
    wound: "Изгнание из родных земель оставило шрам, который не виден, но чувствуется в каждом шаге.",
    promise: "Найти место, где молчание не будет в тягость.",
    principle: "Не отворачиваться от тех, кто просит о помощи.",
    profileVersion: 2,
    history: "Ты пришёл с северной дороги после изгнания и знаешь, как долго человек может идти, не называя места домом.",
    startingKnowledge: "Ты узнаёшь старые дорожные знаки и умеешь отличать честную просьбу о помощи от ловушки.",
    openingHook: "На северной дороге ты видел знак, который не должен был оказаться у этой переправы.",
    startingTestimony: "Свидетельство о неверно установленном знаке на северной дороге.",
    startingContact: "Перевозчик у переправы.",
    startingItem: "Обломок северного дорожного знака.",
    familiarPlace: "Дорога от переправы к Речному Стражу.",
    procedureKnowledge: "Чтение старых дорожных знаков.",
    startingTestimonyRefs: ["testimony:wanderer-north-road-marker"],
    contactRefs: ["contact:waystation-ferryman"],
    startingItemRefs: ["item:wanderer-road-marker"],
    familiarSpatialRefs: ["relation:road_waystation_city", "relation:river_crossing"],
    procedureKnowledgeRefs: ["knowledge:read-road-signs"],
    openingHookRef: "hook:wanderer-misplaced-marker",
    canonicalRefs: ["regions.pilot-region.geography.f5"],
  },
  keeper: {
    id: "keeper",
    title: "Последний ученик сгоревшего архива",
    shortDescription: "Последний ученик архива, который ищет исчезнувшую запись о Бассейне.",
    formerRole: "Ты переписывал каталоги и сохранял надписи для архива, пока тот не стал твоим пеплом.",
    rupture: "Архив сгорел вместе с каталогом и именами тех, кто его охранял.",
    reasonInRegion: "Перед пожаром из архива исчезла запись о Бассейне Речного Стража; её след привёл тебя к переправе.",
    knownConnection: "Ты знаком с архивистом Речного Стража и узнаёшь кладку старых построек.",
    obligation: "Восстановить исчезнувшую запись и передать её тому, кто сможет сохранить её дальше.",
    description: "Последний ученик архива, который несёт уцелевшую память через пепел.",
    wound: "Потеря библиотеки — единственного дома, который у тебя был.",
    promise: "Сохранить то, что осталось, и передать дальше.",
    principle: "Знание нельзя уничтожать, даже если оно опасно.",
    profileVersion: 2,
    history: "Ты был последним учеником архива, сгоревшего вместе с его каталогом и именами тех, кто его охранял.",
    startingKnowledge: "Ты умеешь читать следы старых построек и замечаешь, когда местная история не сходится с рассказом очевидцев.",
    openingHook: "Перед пожаром из архива исчезла одна запись о Бассейне Речного Стража.",
    startingTestimony: "Свидетельство об исчезнувшей записи о Бассейне.",
    startingContact: "Архивист Речного Стража.",
    startingItem: "Письменные принадлежности архивиста.",
    familiarPlace: "Дорога к Речному Стражу и след старой кладки.",
    procedureKnowledge: "Бережное копирование старой надписи.",
    startingTestimonyRefs: ["testimony:keeper-missing-basin-record"],
    contactRefs: ["contact:riverwatch-archivist"],
    startingItemRefs: ["item:keeper-writing-kit"],
    familiarSpatialRefs: ["location:river_waystation", "relation:road_waystation_city"],
    procedureKnowledgeRefs: ["knowledge:preserve-inscription"],
    openingHookRef: "hook:keeper-missing-basin-record",
    canonicalRefs: ["regions.pilot-region.history.f1", "regions.pilot-region.history.f2", "regions.pilot-region.history.f4"],
  },
  echo: {
    id: "echo",
    title: "Свидетель ночи у переправы",
    shortDescription: "Свидетель ночного происшествия, который больше не отводит взгляд.",
    formerRole: "Ты был ночным дозорным и привык замечать звук раньше, чем его источник.",
    rupture: "У переправы ты увидел то, чему не смог дать имени, и промолчал.",
    reasonInRegion: "Повторяющийся удар воды перед рассветом вернул тебя к той же переправе.",
    knownConnection: "Ты знаешь ночного перевозчика и помнишь старое русло по звуку воды.",
    obligation: "Выяснить, что вынесло течение той ночью, и наконец рассказать об этом.",
    description: "Свидетель ночи у переправы, который учится отличать память от слуха.",
    wound: "Ты стал свидетелем того, чего не должно было случиться, и промолчал.",
    promise: "Никогда больше не отводить взгляд.",
    principle: "Поступки важнее слов.",
    profileVersion: 2,
    history: "Ты оказался свидетелем ночи у переправы и промолчал, когда течение вынесло к берегу нечто, чему не было названия.",
    startingKnowledge: "Ты внимателен к звукам, следам и паузам в чужой речи, но не уверен, чему из услышанного можно верить.",
    openingHook: "С тех пор перед рассветом тебе слышится тот же удар воды о сваи.",
    startingTestimony: "Свидетельство о ночном происшествии у переправы.",
    startingContact: "Ночной перевозчик.",
    startingItem: "Узелковый шнур ночного дозорного.",
    familiarPlace: "Переправа и ритм старого русла.",
    procedureKnowledge: "Отметка повторяющегося ритма течения.",
    startingTestimonyRefs: ["testimony:echo-night-crossing"],
    contactRefs: ["contact:night-ferryman"],
    startingItemRefs: ["item:echo-signal-cord"],
    familiarSpatialRefs: ["relation:river_crossing", "location:river_waystation"],
    procedureKnowledgeRefs: ["knowledge:listen-to-current"],
    openingHookRef: "hook:echo-repeating-impact",
    canonicalRefs: ["regions.pilot-region.geography.f5", "regions.pilot-region.history.f3"],
  },
};

for (const key of Object.keys(_backgrounds)) Object.freeze(_backgrounds[key]!);
Object.freeze(_backgrounds);

export const CHARACTER_BACKGROUNDS: Readonly<Record<string, Readonly<CharacterBackground>>> = _backgrounds;

/** @deprecated Compatibility name for clients from the preset era. */
export const CHARACTER_PRESETS: Readonly<Record<string, Readonly<CharacterPreset>>> = _backgrounds;

export function getCharacterBackground(id: string): CharacterBackground | null {
  return _backgrounds[id] ?? null;
}

export function listCharacterBackgrounds(): CharacterBackground[] {
  return Object.values(_backgrounds);
}

/** @deprecated Use getCharacterBackground. */
export function getCharacterPreset(id: string): CharacterPreset | null {
  return getCharacterBackground(id);
}

/** @deprecated Use listCharacterBackgrounds. */
export function listCharacterPresets(): CharacterPreset[] {
  return listCharacterBackgrounds();
}
