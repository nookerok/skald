import type { InquiryQueryId, InquiryRequest } from "@skald/intent-parser";
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
}

export interface InquiryAnswerDTO {
  readonly queryId: InquiryQueryId;
  readonly answer: string;
  readonly revision: {
    readonly worldTime: number;
    readonly eventNumber: number;
  };
}

export type InquiryQueryHandler = (
  request: InquiryRequest,
  context: InquiryReadContext,
) => InquiryAnswerDTO;
