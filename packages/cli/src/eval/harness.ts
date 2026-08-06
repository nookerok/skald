/**
 * Scenario harness (packages/cli/src/eval/harness.ts).
 *
 * Drives the canonical simulation core with scripted player intent and records
 * the observer-scoped player view after every step. Reuses the production
 * composition path: WorldProjector + createRules + RuleEngine + the same
 * runCommandCycle / runOfflineTicks used by the CLI and HTTP surfaces, so a
 * scenario exercises exactly the code a real player would hit.
 */

import { EventBus } from "@skald/event-bus";
import { RuleEngine, RuleRegistry } from "@skald/rule-engine";
import type { DomainEvent } from "@skald/event-bus";
import {
  WorldProjector,
  createRules,
  buildBootstrapEvents,
  buildGameShellSnapshot,
  buildBeliefModel,
  serializeBeliefModel,
  selectTurnPresentation,
  buildObserverMap,
  buildSpatialWorldProjection,
  type ReadonlyWorld,
} from "@skald/world";
import type { App } from "../index.js";
import { runCommandCycle, runOfflineTicks } from "../index.js";
import { serializeWorldState } from "../state-view.js";
import { evaluateCheck } from "./checks.js";
import { audit } from "./auditor.js";
import type { CheckContext, EvalReport, RuleCoverage, Scenario, ScenarioStep, StepResult, TurnTranscript } from "./types.js";

export interface Harness {
  readonly app: App;
  readonly runScenario: (scenario: Scenario) => EvalReport;
  readonly getRuleCoverage: () => RuleCoverage;
}

function idempotencyKey(scenario: string, index: number): string {
  return `eval:${scenario}:${index}`;
}

function safe<T>(label: string, fn: () => T): T | { readonly __evalError: string } {
  try {
    return fn();
  } catch (err) {
    return { __evalError: `${label}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function buildTranscript(app: App, turnEvents: readonly DomainEvent[], templateId: string): TurnTranscript {
  const events = app.bus.query();
  const world = app.projection.getSnapshot();
  const transcript: TurnTranscript = {
    state: safe("state", () => serializeWorldState(app)),
    presentation: safe("presentation", () => selectTurnPresentation(turnEvents, world)),
    gameShell: safe("gameShell", () => buildGameShellSnapshot(events, world, null, app.worldId)),
    belief: safe("belief", () => serializeBeliefModel(buildBeliefModel(events, world, "player"))),
    ...(templateId === "living_region"
      ? { observerMap: safe("observerMap", () => buildObserverMap(events, buildSpatialWorldProjection(events), true)) }
      : {}),
  };
  return transcript;
}

function stepTranscriptJson(transcript: TurnTranscript): string {
  return JSON.stringify(transcript);
}

export function createHarness(templateId: string, worldId = "eval"): Harness {
  const bus = new EventBus();
  const projection = new WorldProjector();
  const bootstrap = buildBootstrapEvents(templateId);
  for (const event of bootstrap) {
    bus.append(event);
    projection.apply(event);
  }
  // Instrument the rules for coverage: a rule "fired" when its handle produced
  // at least one event. createRules() registers shared module-level rule
  // objects, so we NEVER mutate them: we build a fresh registry of wrapped
  // copies. This keeps evaluation behaviour-identical without touching the
  // shared composition, even if the harness ever runs in-process with other
  // consumers of createRules().
  const baseRules = createRules().listRules();
  const registry = new RuleRegistry<ReadonlyWorld>();
  const ruleCoverage = new Map<string, number>();
  const ruleProduced = new Map<string, Set<string>>();
  for (const rule of baseRules) {
    registry.register({
      ...rule,
      handle: (event, world) => {
        const produced = rule.handle(event, world);
        if (produced.length > 0) {
          ruleCoverage.set(rule.id, (ruleCoverage.get(rule.id) ?? 0) + 1);
          const set = ruleProduced.get(rule.id) ?? new Set<string>();
          for (const producedEvent of produced) set.add(producedEvent.type);
          ruleProduced.set(rule.id, set);
        }
        return produced;
      },
    });
  }
  const engine = new RuleEngine(registry, projection, bus);
  const processedKeys = new Set<string>();
  const app: App = { bus, registry, engine, projection, processedKeys, router: null, store: null, worldId };

  const getRuleCoverage = (): RuleCoverage => {
    const produced = new Map<string, readonly string[]>();
    for (const [id, types] of ruleProduced) produced.set(id, [...types].sort());
    return { fired: new Map(ruleCoverage), produced, total: registry.listRules().length };
  };

  function runStep(scenario: Scenario, index: number, step: ScenarioStep): Omit<StepResult, "failures"> {
    if ("input" in step) {
      const result = runCommandCycle(app, step.input, idempotencyKey(scenario.name, index));
      if (!result || typeof result !== "object" || !("events" in result)) {
        const reason = result && typeof result === "object" && "type" in result
          ? String((result as { type: unknown }).type)
          : "unexpected result";
        throw new Error(`step ${index}: command "${step.input}" was not accepted (${reason})`);
      }
      const turnEvents = [...result.events, ...result.tickEvents];
      const transcript = buildTranscript(app, turnEvents, templateId);
      return {
        step,
        committedEvents: app.bus.query().map((e) => e.type),
        lastStepEvents: turnEvents,
        worldTime: app.projection.getSnapshot().time,
        transcript,
      };
    }
    if ("wait" in step) {
      const result = runOfflineTicks(app, step.wait, idempotencyKey(scenario.name, index));
      if (!result || typeof result !== "object" || !("tickEvents" in result)) {
        throw new Error(`step ${index}: wait(${step.wait}) was not accepted`);
      }
      const transcript = buildTranscript(app, result.tickEvents, templateId);
      return {
        step,
        committedEvents: app.bus.query().map((e) => e.type),
        lastStepEvents: result.tickEvents,
        worldTime: app.projection.getSnapshot().time,
        transcript,
      };
    }
    throw new Error(`step ${index}: unsupported step`);
  }

  function checkContext(step: StepResult | null): CheckContext {
    const world = app.projection.getSnapshot();
    const transcript = step?.transcript ?? buildTranscript(app, [], templateId);
    return {
      allEvents: app.bus.query(),
      lastStepEvents: step?.lastStepEvents ?? [],
      world,
      stateJson: JSON.stringify(transcript.state),
      beliefJson: JSON.stringify(transcript.belief),
      transcript,
      worldTime: world.time,
    };
  }

  function runScenario(scenario: Scenario): EvalReport {
    const steps: StepResult[] = [];
    const failures: string[] = [];

    for (let i = 0; i < scenario.turns.length; i++) {
      const step = scenario.turns[i]!;
      if ("assert" in step) {
        const ctx = checkContext(steps[i - 1] ?? null);
        const stepFailures = step.assert.checks
          .map((check) => evaluateCheck(check, ctx))
          .filter((reason) => reason !== "");
        failures.push(...stepFailures);
        steps.push({
          step,
          committedEvents: app.bus.query().map((e) => e.type),
          lastStepEvents: ctx.lastStepEvents,
          worldTime: app.projection.getSnapshot().time,
          transcript: ctx.transcript,
          failures: stepFailures,
        });
        continue;
      }
      const result = runStep(scenario, i, step);
      const ctx: CheckContext = {
        allEvents: app.bus.query(),
        lastStepEvents: result.lastStepEvents,
        world: app.projection.getSnapshot(),
        stateJson: JSON.stringify(result.transcript.state),
        beliefJson: JSON.stringify(result.transcript.belief),
        transcript: result.transcript,
        worldTime: result.worldTime,
      };
      steps.push({ ...result, failures: [] });
      void ctx;
    }

    const finalCheckFailures = (scenario.finalChecks ?? [])
      .map((check) => evaluateCheck(check, checkContext(steps[steps.length - 1] ?? null)))
      .filter((reason) => reason !== "");

    // Idempotency probe: replay the last action with the same key.
    let idempotencyProbe: { duplicateRejected: boolean; noNewEvents: boolean } | null = null;
    const lastAction = [...scenario.turns].reverse().find((step) => !("assert" in step));
    if (lastAction) {
      const beforeCount = app.bus.query().length;
      const lastIndex = scenario.turns.indexOf(lastAction);
      if ("input" in lastAction) {
        const replay = runCommandCycle(app, lastAction.input, idempotencyKey(scenario.name, lastIndex));
        idempotencyProbe = {
          duplicateRejected: !!replay && typeof replay === "object" && (replay as { type?: string }).type === "IdempotencyReject",
          noNewEvents: app.bus.query().length === beforeCount,
        };
      } else if ("wait" in lastAction) {
        const replay = runOfflineTicks(app, lastAction.wait, idempotencyKey(scenario.name, lastIndex));
        idempotencyProbe = {
          duplicateRejected: !!replay && typeof replay === "object" && (replay as { type?: string }).type === "IdempotencyReject",
          noNewEvents: app.bus.query().length === beforeCount,
        };
      }
    }

    const worldTimes = steps.filter((s) => !("assert" in s.step)).map((s) => s.worldTime);
    const auditResult = audit({
      allEvents: app.bus.query(),
      liveWorld: app.projection.getSnapshot(),
      worldTimes,
      idempotencyProbe,
      transcriptJsons: steps.map((s) => stepTranscriptJson(s.transcript)),
      presentationTexts: steps.flatMap((s) => {
        const presentation = s.transcript.presentation as { primary?: { text?: string }; notable?: Array<{ text?: string }>; background?: Array<{ text?: string }> } | null;
        const texts: string[] = [];
        if (presentation?.primary?.text) texts.push(presentation.primary.text);
        for (const entry of presentation?.notable ?? []) if (entry.text) texts.push(entry.text);
        for (const entry of presentation?.background ?? []) if (entry.text) texts.push(entry.text);
        return texts;
      }),
    });

    const allFailures = [...failures, ...finalCheckFailures, ...auditResult.notes];
    return {
      name: scenario.name,
      worldTemplate: scenario.worldTemplate,
      steps,
      finalCheckFailures,
      audit: auditResult,
      pass: allFailures.length === 0,
      ...(scenario.description !== undefined ? { description: scenario.description } : {}),
    };
  }

  return { app, runScenario, getRuleCoverage };
}
