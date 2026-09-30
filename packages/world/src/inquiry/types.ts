import type { InquiryQueryId, InquiryRequest, QuestionListRef } from "@skald/intent-parser";
import type { BackgroundNarrativeContext } from "../setup/background-context.js";
import type { GameShellSnapshot } from "../game-shell/types.js";
import type { MasterTurnSceneContext } from "../master-turn/observer-context.js";

export interface InquiryReadContext {
  readonly shell: GameShellSnapshot;
  readonly background: BackgroundNarrativeContext | null;
  /**
   * Observer-safe scene when the caller already built one (production
   * command path). Person questions answer from its knownPeople; without a
   * scene they honestly report nobody distinguishable.
   */
  readonly scene?: MasterTurnSceneContext | null | undefined;
  /**
   * The hero's given arrival reason (T6 acceptance, series 1): the identity
   * answer carries origin alongside role so «Как я здесь оказался?» is
   * answered with the arrival story, not just the name. Resolved by the
   * caller from the character background — never from the phrasing.
   */
  readonly arrivalReason?: string | null | undefined;
}

/**
 * One ordered list an inquiry answer actually showed, as structured data
 * from the builder — never a re-parse of prose. `listRef` is closed by
 * `QUESTION_LIST_REFS` (`QuestionListRef`); members are ordered player-facing
 * labels (semantic-question-plan T5), so conversation memory can record the
 * shown list for later ordinal references.
 */
export interface InquiryShownList {
  readonly listRef: QuestionListRef;
  readonly members: readonly string[];
  /** Ephemeral handles aligned with the displayed lines; never durable identity. */
  readonly observerRefs?: readonly string[];
}

export interface InquiryAnswerDTO {
  readonly queryId: InquiryQueryId;
  readonly answer: string;
  readonly revision: {
    readonly worldTime: number;
    readonly eventNumber: number;
  };
  /** Lists this answer presented in order, when any (T5). */
  readonly shownLists?: readonly InquiryShownList[] | undefined;
}

export type InquiryQueryHandler = (
  request: InquiryRequest,
  context: InquiryReadContext,
) => InquiryAnswerDTO;
