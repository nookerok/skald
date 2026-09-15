import { describe, it, expect } from "vitest";
import { verifyGameNarration } from "../src/game-director/narration-quality.js";

const ACTION = "Я осматриваю переправу и слушаю воду";
const OUTCOME = "Ты прислушиваешься к воде. Под настилом слышны тяжёлые удары течения.";
const FACTS = [
  "Переправа: Вода поднялась.",
  "Ты знаком с перевозчиком.",
  "Открыт путь к «Речному Стражу».",
];

describe("verifyGameNarration", () => {
  it("accepts prose grounded in the outcome and the replica", () => {
    expect(verifyGameNarration({
      narration: "Ты прислушиваешься к воде у переправы, и течение отвечает тяжёлыми ударами.",
      playerAction: ACTION,
      outcomeText: OUTCOME,
      allowedFacts: FACTS,
    })).toEqual({ ok: true });
  });
  it("tolerates ordinary Russian inflection in names and words", () => {
    expect(verifyGameNarration({
      narration: "Ты расспрашиваешь Перевозчика о переправе, и течение отвечает тяжёлыми ударами.",
      playerAction: "Расспросить перевозчика о переправе",
      outcomeText: "Перевозчик отвечает и показывает на течение.",
      allowedFacts: ["Ты знаком с перевозчиком.", "Переправа: Вода поднялась."],
    })).toEqual({ ok: true });
  });
  it("rejects empty prose", () => {
    expect(verifyGameNarration({ narration: "   ", playerAction: ACTION })).toEqual({ ok: false, reason: "empty" });
  });
  it("rejects internal identifiers", () => {
    expect(verifyGameNarration({
      narration: "Ты видишь risk_taken у переправы.",
      playerAction: ACTION,
      outcomeText: OUTCOME,
      allowedFacts: FACTS,
    })).toEqual({ ok: false, reason: "internal_id_leak" });
    expect(verifyGameNarration({
      narration: "Ты видишь contact:ferryman у переправы.",
      playerAction: ACTION,
    })).toEqual({ ok: false, reason: "internal_id_leak" });
  });
  it("rejects overlong prose", () => {
    const long = `${"Вода шумит у переправы. ".repeat(60)}`;
    const result = verifyGameNarration({ narration: long, playerAction: ACTION });
    expect(result).toEqual({ ok: false, reason: "too_long" });
    const many = ["Раз", "Два", "Три", "Четыре", "Пять", "Шесть", "Семь"].map((word) => `${word} слово`).join(". ") + ".";
    expect(verifyGameNarration({ narration: many, playerAction: "слово" }).ok).toBe(false);
  });
  it("rejects prose that loses the deterministic outcome", () => {
    expect(verifyGameNarration({
      narration: "Тихое озеро спит под луной.",
      playerAction: ACTION,
      outcomeText: OUTCOME,
      allowedFacts: FACTS,
    })).toEqual({ ok: false, reason: "outcome_lost" });
  });
  it("rejects prose reacting to neither replica nor outcome", () => {
    expect(verifyGameNarration({
      narration: "Тихое озеро спит под луной.",
      playerAction: "Осмотреть переправу",
    })).toEqual({ ok: false, reason: "missing_reaction" });
  });
  it("passes the reaction check through shared outcome words", () => {
    expect(verifyGameNarration({
      narration: "Ты прислушиваешься к воде, течение отвечает ударами.",
      playerAction: "Совсем другой текст без общих слов",
      outcomeText: OUTCOME,
      allowedFacts: FACTS,
    })).toEqual({ ok: true });
  });
  it("rejects a mid-sentence proper name outside the allowed vocabulary", () => {
    expect(verifyGameNarration({
      narration: "Ты прислушиваешься к воде, и Морвана шепчет из течения.",
      playerAction: ACTION,
      outcomeText: OUTCOME,
      allowedFacts: FACTS,
    })).toEqual({ ok: false, reason: "new_proper_name" });
  });
  it("ignores sentence-initial capitals as ordinary orthography", () => {
    expect(verifyGameNarration({
      narration: "Переправа шумит. Ты прислушиваешься к воде и течению.",
      playerAction: ACTION,
      outcomeText: OUTCOME,
      allowedFacts: FACTS,
    })).toEqual({ ok: true });
  });
  it("rejects created items dressed as acquisition", () => {
    expect(verifyGameNarration({
      narration: "Ты нашёл древний амулет, и течение стихло.",
      playerAction: ACTION,
      outcomeText: "Течение стихло у переправы.",
      allowedFacts: ["Переправа: Вода поднялась."],
    })).toEqual({ ok: false, reason: "new_item_claim" });
  });
  it("accepts grounded acquisition of a known item", () => {
    expect(verifyGameNarration({
      narration: "Ты берёшь верёвку, течение отвечает ударами у переправы.",
      playerAction: "Взять верёвку у переправы",
      outcomeText: "Ты берёшь верёвку. Течение отвечает ударами.",
      allowedFacts: ["Среди твоих вещей: верёвка."],
    })).toEqual({ ok: true });
  });
});
