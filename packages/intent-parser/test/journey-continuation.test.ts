import { describe, expect, it } from "vitest";
import { isContinuingJourneyTo, isJourneyContinuation } from "@skald/intent-parser";

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
    "ищу безопасный проход дальше",
    "ищу обход",
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
    "ищу факел",
    "ищу перевозчика",
  ])("does not treat %j as a journey continuation", (input) => {
    expect(isJourneyContinuation(input)).toBe(false);
  });
});

describe("isContinuingJourneyTo — same active destination is progress", () => {
  const city = "Речной Страж";
  it.each([
    "Продолжаю путь к Речному Стражу, держась ближе к реке и высматривая след на воде",
    "Иду в Речной Страж",
    "продолжаю путь к речному стражу",
    "двигаюсь к Речному Стражу",
    "вхожу в Речной Страж",
    "перехожу к Речному Стражу",
  ])("treats %j as continuing the active leg", (input) => {
    expect(isContinuingJourneyTo(input, city)).toBe(true);
  });
  it.each([
    ["продолжаю путь к реке", city],
    ["иду к развалинам", city],
    ["осматриваюсь", city],
    ["Иду в Речной Страж", null],
    ["Иду в Речной Страж", "  "],
    ["двигаюсь к развалинам", city],
    ["вхожу в другой город", city],
  ])("does not treat %j as continuing %j", (input, destination) => {
    expect(isContinuingJourneyTo(input, destination)).toBe(false);
  });
});
