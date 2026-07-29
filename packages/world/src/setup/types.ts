export interface CharacterPreset {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly wound: string;
  readonly promise: string;
  readonly principle: string;
  readonly profileVersion: number;
}

export interface WorldTemplate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly startingQuestion: string;
  readonly templateVersion: number;
  readonly available: boolean;
}
