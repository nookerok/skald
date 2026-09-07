/**
 * Closed meta answers (ADR-0028, plan_6 Stage 12).
 *
 * Pure read-side prose for the four registered meta operations. The function
 * takes no world, store, router or settings handle, so a meta turn can never
 * delete saves, change the world, run admin commands, touch settings,
 * deploy, or open hidden diagnostics. An unregistered operation degrades to
 * a natural refusal without any execution; unknown model output is already
 * rejected earlier by static schema validation.
 */

import { MASTER_TURN_AVAILABLE_ACTIONS, operationLabel } from "@skald/world";
import type { TurnMetaOperation } from "@skald/intent-parser";
import type { MasterConversationTurn } from "./context-builder.js";

/** Read-side context for meta answers: recent turns for repeats only. */
export interface MetaAnswerContext {
  readonly recentTurns: readonly MasterConversationTurn[];
}

/** One meta answer prose. Carries no effects by construction. */
export interface MetaAnswer {
  readonly text: string;
}

const NO_PREVIOUS_ANSWER = "Пока повторять нечего — это начало разговора.";

const MAP_HINT =
  "Карту смотри в представлении «Карта»: там только разведанные места, остальной регион скрыт туманом.";

const INTERFACE_HELP =
  "Пиши намерение в поле ввода и нажимай Enter — рядом есть кнопка отправки. Ответы МАСТЕРа появляются в ленте выше.";

const UNKNOWN_META_OPERATION =
  "Такое действие мне недоступно. Могу повторить последний ответ, подсказать доступные действия или объяснить интерфейс.";

const AVAILABLE_ACTIONS_TEXT: string = (() => {
  const names = MASTER_TURN_AVAILABLE_ACTIONS.map((action) => `${operationLabel(action.verb)} (${action.verb})`);
  return `Доступные действия: ${names.join(", ")}. Назови одно из них своими словами — например, цель и действие.`;
})();

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

/**
 * Answers one registered meta operation. Pure and total: unknown operations
 * fall back to a natural refusal, never to execution.
 */
export function answerMetaRequest(operation: TurnMetaOperation, context: MetaAnswerContext): MetaAnswer {
  switch (operation) {
    case "repeat_last_answer": {
      for (let index = context.recentTurns.length - 1; index >= 0; index -= 1) {
        const turn = context.recentTurns[index]!;
        if (turn.speaker === "master") return freeze({ text: turn.text });
      }
      return freeze({ text: NO_PREVIOUS_ANSWER });
    }
    case "explain_available_actions":
      return freeze({ text: AVAILABLE_ACTIONS_TEXT });
    case "open_map_hint":
      return freeze({ text: MAP_HINT });
    case "explain_interface":
      return freeze({ text: INTERFACE_HELP });
    default:
      return freeze({ text: UNKNOWN_META_OPERATION });
  }
}
