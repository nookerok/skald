/**
 * Critical Check types for Iteration 15.
 *
 * Critical checks represent uncertain outcomes with meaningful stakes.
 * The flow is:
 *   Rule → CriticalCheckRequested (deterministic)
 *     → Infrastructure Dice Roller (Math.random ONCE)
 *       → CriticalCheckRolled (recorded in Event Log)
 *         → Resolution Rule (deterministic)
 *           → CriticalCheckResolved + world effects
 */

export type CheckKind = "force" | "precision" | "endurance" | "control";
export type DieType = "d20";
export type CheckOutcome = "critical_failure" | "failure" | "success" | "critical_success";

export interface CriticalModifier {
  readonly label: string;
  readonly delta: number;
}

export interface CriticalCheckState {
  readonly checkId: string;
  readonly actionEventId: string;
  readonly checkKind: CheckKind;
  readonly die: DieType;
  readonly difficulty: number;
  readonly modifiers: readonly CriticalModifier[];
  readonly stakes: {
    readonly success: string;
    readonly failure: string;
  };
  readonly targetObjectId: string;
  readonly targetObjectName: string;
  readonly locationId: string;
  readonly rolled: boolean;
  readonly naturalRoll?: number;
  readonly total?: number;
  readonly outcome?: CheckOutcome;
}
