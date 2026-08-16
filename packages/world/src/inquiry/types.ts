import type { InquiryQueryId, InquiryRequest } from "@skald/intent-parser";
import type { BackgroundNarrativeContext } from "../setup/background-context.js";
import type { GameShellSnapshot } from "../game-shell/types.js";

export interface InquiryReadContext {
  readonly shell: GameShellSnapshot;
  readonly background: BackgroundNarrativeContext | null;
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
