import { describe, it, expect } from "vitest";
import { parseCommand, type MoveCommand, type GiveCommand, type ParseError } from "@skald/intent-parser";

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

  it("parses give help to guild", () => {
    const result = parseCommand("give help to guild") as GiveCommand;
    expect(result).toEqual({ type: "GiveCommand", relation: "help", target: "guild" });
  });

  it("parses give respect to merchant", () => {
    const result = parseCommand("give respect to merchant") as GiveCommand;
    expect(result).toEqual({ type: "GiveCommand", relation: "respect", target: "merchant" });
  });

  it("parses give fear to dragon", () => {
    const result = parseCommand("give fear to dragon") as GiveCommand;
    expect(result).toEqual({ type: "GiveCommand", relation: "fear", target: "dragon" });
  });

  it.each([
    "GIVE HELP TO GUILD",
    "  give  help  to  guild  ",
  ])("is case-insensitive and trims whitespace for give: %j", (input) => {
    const result = parseCommand(input) as GiveCommand;
    expect(result).toEqual({ type: "GiveCommand", relation: "help", target: "guild" });
  });

  it("returns ParseError for unknown relation", () => {
    const result = parseCommand("give energy to guild") as ParseError;
    expect(result.type).toBe("ParseError");
    expect(result.reason).toContain("unknown relation");
  });

  it("returns ParseError when 'to' is missing", () => {
    const result = parseCommand("give help guild") as ParseError;
    expect(result.type).toBe("ParseError");
    expect(result.reason).toContain("unknown command");
  });

  it("returns ParseError for empty target", () => {
    const result = parseCommand("give help to") as ParseError;
    expect(result.type).toBe("ParseError");
    expect(result.reason).toContain("unknown command");
  });
});