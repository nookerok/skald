import { describe, expect, it } from "vitest";
import { sameRussianStem, stemRussianToken } from "@skald/intent-parser";

describe("shared Russian nominal stemming", () => {
  it.each([
    ["воде", "вода"],
    ["воду", "вода"],
    ["воды", "вода"],
    ["переправу", "переправа"],
    ["переправе", "переправа"],
    ["переправой", "переправа"],
    ["речному", "речной"],
    ["речного", "речной"],
    ["стражу", "страж"],
    ["стража", "страж"],
    ["оградой", "ограда"],
    ["ограду", "ограда"],
  ] as const)("matches declined %j to nominative %j", (declined, nominative) => {
    expect(sameRussianStem(declined, nominative)).toBe(true);
    expect(sameRussianStem(nominative, declined)).toBe(true);
  });

  it.each([
    ["река", "рука"],
    ["мост", "место"],
    ["лес", "лиса"],
    ["страж", "страна"],
    ["вода", "водовоз"],
    ["он", "она"],
  ] as const)("does not link distinct words %j and %j", (left, right) => {
    expect(sameRussianStem(left, right)).toBe(false);
    expect(sameRussianStem(right, left)).toBe(false);
  });

  it("keeps stems stable and conservative", () => {
    expect(stemRussianToken("Воде")).toBe(stemRussianToken("вода"));
    expect(stemRussianToken("Ёлка")).toBe(stemRussianToken("елка"));
    expect(stemRussianToken("")).toBe("");
  });
});
