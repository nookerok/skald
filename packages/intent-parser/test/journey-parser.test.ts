import { describe, it, expect } from "vitest";
import { interpretIntent } from "@skald/intent-parser";
import type { JourneyIntent, ActionIntentCommand } from "@skald/intent-parser";

describe("interpretIntent — travel (ADR-0015)", () => {
  it("recognizes Russian travel verb «идти к Речному Стражу»", () => {
    const result = interpretIntent("идти к Речному Стражу");
    expect(result.type).toBe("JourneyIntent");
    const cmd = result as JourneyIntent;
    // Parser normalizes to lowercase
    expect(cmd.destination.raw).toBe("речному стражу");
  });

  it("recognizes «пойти к реке»", () => {
    const result = interpretIntent("пойти к реке");
    expect(result.type).toBe("JourneyIntent");
    const cmd = result as JourneyIntent;
    expect(cmd.destination.raw).toBe("реке");
  });

  it("recognizes «добраться до руин»", () => {
    const result = interpretIntent("добраться до руин");
    expect(result.type).toBe("JourneyIntent");
    const cmd = result as JourneyIntent;
    expect(cmd.destination.raw).toBe("руин");
  });

  it("recognizes «перейти переправу»", () => {
    const result = interpretIntent("перейти переправу");
    expect(result.type).toBe("JourneyIntent");
    const cmd = result as JourneyIntent;
    expect(cmd.destination.raw).toBe("переправу");
  });

  it("recognizes «двигаться по дороге к лесу»", () => {
    const result = interpretIntent("двигаться по дороге к лесу");
    expect(result.type).toBe("JourneyIntent");
    const cmd = result as JourneyIntent;
    // extractTarget strips Russian prepositions like "к"
    expect(cmd.destination.raw).toBe("дороге к лесу");
  });

  it("recognizes English «go to Riverwatch»", () => {
    const result = interpretIntent("go to Riverwatch");
    expect(result.type).toBe("JourneyIntent");
    const cmd = result as JourneyIntent;
    // Parser normalizes to lowercase, extractTarget doesn't strip English "to"
    expect(cmd.destination.raw).toBe("to riverwatch");
  });

  it("recognizes English «walk to the ruins»", () => {
    const result = interpretIntent("walk to the ruins");
    expect(result.type).toBe("JourneyIntent");
    const cmd = result as JourneyIntent;
    expect(cmd.destination.raw).toBe("to the ruins");
  });

  it("direction words still produce ActionIntentCommand (legacy relocate)", () => {
    const result = interpretIntent("идти на север");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("relocate");
    expect(cmd.operation).toBe("approach");
    expect(cmd.target?.raw).toBe("north");
  });

  it("direction words «на юг» still produce legacy relocate", () => {
    const result = interpretIntent("идти на юг");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("relocate");
    expect(cmd.target?.raw).toBe("south");
  });

  it("without destination returns JourneyIntent with empty destination", () => {
    const result = interpretIntent("идти");
    expect(result.type).toBe("JourneyIntent");
    const cmd = result as JourneyIntent;
    expect(cmd.destination.raw).toBe("");
  });

  it("recognizes a stop command as an interrupt action", () => {
    const result = interpretIntent("остановиться");
    expect(result.type).toBe("ActionIntentCommand");
    const cmd = result as ActionIntentCommand;
    expect(cmd.mode).toBe("travel");
    expect(cmd.operation).toBe("interrupt");
  });

  it("carries rawText from original input", () => {
    const result = interpretIntent("ИДТИ К РЕЧНОМУ СТРАЖУ");
    expect(result.type).toBe("JourneyIntent");
    expect((result as JourneyIntent).rawText).toBe("ИДТИ К РЕЧНОМУ СТРАЖУ");
  });

  it("carries interpretation metadata", () => {
    const result = interpretIntent("идти к реке");
    expect(result.type).toBe("JourneyIntent");
    const cmd = result as JourneyIntent;
    expect(cmd.interpretation.source).toBe("deterministic");
    expect(cmd.interpretation.confidence).toBeGreaterThan(0);
  });
});
