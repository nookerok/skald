import { describe, it, expect } from "vitest";
import { parseCommand, type MoveCommand, type ParseError } from "@skald/intent-parser";

describe("parseCommand", () => {
  it("parses all four directions", () => {
    const north = parseCommand("move north") as MoveCommand;
    const south = parseCommand("move south") as MoveCommand;
    const east = parseCommand("move east") as MoveCommand;
    const west = parseCommand("move west") as MoveCommand;

    expect(north).toEqual({ type: "MoveCommand", direction: "north" });
    expect(south).toEqual({ type: "MoveCommand", direction: "south" });
    expect(east).toEqual({ type: "MoveCommand", direction: "east" });
    expect(west).toEqual({ type: "MoveCommand", direction: "west" });
  });

  it.each([
    "MOVE NORTH",
    "Move North",
    "  move   north  ",
    "\tmove\tnorth\t",
  ])("is case-insensitive and trims whitespace for %j", (input) => {
    const result = parseCommand(input) as MoveCommand;
    expect(result).toEqual({ type: "MoveCommand", direction: "north" });
  });

  it("returns ParseError for garbage input", () => {
    const result = parseCommand("jusyxbz") as ParseError;
    expect(result.type).toBe("ParseError");
    expect(result.reason).toContain("unknown command");
  });

  it("returns ParseError for unknown verbs", () => {
    const result = parseCommand("attack north") as ParseError;
    expect(result.type).toBe("ParseError");
    expect(result.reason).toContain("unknown command");
  });

  it("returns ParseError for unknown directions", () => {
    const result = parseCommand("move up") as ParseError;
    expect(result.type).toBe("ParseError");
    expect(result.reason).toContain("unknown direction");
  });

  it("returns ParseError for empty input", () => {
    const result = parseCommand("   ") as ParseError;
    expect(result.type).toBe("ParseError");
    expect(result.reason).toBe("empty input");
  });

  it("returns ParseError for extra arguments", () => {
    const result = parseCommand("move north now") as ParseError;
    expect(result.type).toBe("ParseError");
  });
});