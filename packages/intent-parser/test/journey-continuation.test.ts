import { describe, expect, it } from "vitest";
import { isJourneyContinuation } from "@skald/intent-parser";

describe("isJourneyContinuation — closed continuation vocabulary (plan_9 §4)", () => {
  it.each([
    "продолжаю путь",
    "Продолжаю путь",
    "продолжаю путь!",
    "продолжаю идти",
    "продолжаю движение",
    "продолжаю дорогу",
    "продолжить путь",
    "продолжаем идти",
    "иду дальше",
    "дальше иду",
    "двигаюсь дальше",
    "Иду вперёд",
    "двигаюсь вперед",
    "вперед иду",
    "продолжаю идти не останавливаясь",
    "иду не останавливаясь",
    "не останавливаюсь",
    "не останавливаться",
    "без остановки",
    "не стою на месте",
  ])("recognizes %j as a journey continuation", (input) => {
    expect(isJourneyContinuation(input)).toBe(true);
  });

  it.each([
    "",
    "дальше",
    "вперед",
    "иду к реке",
    "продолжаю путь к реке",
    "продолжаю осматриваться",
    "что дальше?",
    "продолжаю путь, но сначала осмотрюсь",
    "останавливаюсь",
    "жду",
    "move north",
  ])("does not treat %j as a journey continuation", (input) => {
    expect(isJourneyContinuation(input)).toBe(false);
  });
});
