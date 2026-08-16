import type { CharacterPreset } from "./types.js";

const _presets: Record<string, CharacterPreset> = {
  wanderer: {
    id: "wanderer",
    title: "Странник",
    description: "Тот, кто несёт молчание и помнит дорогу.",
    wound: "Изгнание из родных земель оставило шрам, который не виден, но чувствуется в каждом шаге.",
    promise: "Найти место, где молчание не будет в тягость.",
    principle: "Не отворачиваться от тех, кто просит о помощи.",
    profileVersion: 1,
    history: "Ты пришёл с северной дороги после изгнания и знаешь, как долго человек может идти, не называя места домом.",
    startingKnowledge: "Ты узнаёшь старые дорожные знаки и умеешь отличать честную просьбу о помощи от ловушки.",
    openingHook: "На северной дороге ты видел знак, который не должен был оказаться у этой переправы.",
  },
  keeper: {
    id: "keeper",
    title: "Хранитель",
    description: "Тот, кто охраняет знание, которое мир предпочёл забыть.",
    wound: "Потеря библиотеки — единственного дома, который у тебя был.",
    promise: "Сохранить то, что осталось, и передать дальше.",
    principle: "Знание нельзя уничтожать, даже если оно опасно.",
    profileVersion: 1,
    history: "Ты был последним учеником архива, сгоревшего вместе с его каталогом и именами тех, кто его охранял.",
    startingKnowledge: "Ты умеешь читать следы старых построек и замечаешь, когда местная история не сходится с рассказом очевидцев.",
    openingHook: "Перед пожаром из архива исчезла одна запись о Бассейне Речного Стража.",
  },
  echo: {
    id: "echo",
    title: "Эхо",
    description: "Тот, кто слышит отзвуки прошлых поступков и не может их игнорировать.",
    wound: "Ты стал свидетелем того, чего не должно было случиться, и промолчал.",
    promise: "Никогда больше не отводить взгляд.",
    principle: "Поступки важнее слов.",
    profileVersion: 1,
    history: "Ты оказался свидетелем ночи у переправы и промолчал, когда течение вынесло к берегу нечто, чему не было названия.",
    startingKnowledge: "Ты внимателен к звукам, следам и паузам в чужой речи, но не уверен, чему из услышанного можно верить.",
    openingHook: "С тех пор перед рассветом тебе слышится тот же удар воды о сваи.",
  },
};

// Deep-freeze at module load
for (const key of Object.keys(_presets)) {
  Object.freeze(_presets[key]!);
}
Object.freeze(_presets);

export const CHARACTER_PRESETS: Readonly<Record<string, Readonly<CharacterPreset>>> = _presets;

export function getCharacterPreset(id: string): CharacterPreset | null {
  return _presets[id] ?? null;
}

export function listCharacterPresets(): CharacterPreset[] {
  return Object.values(_presets);
}
