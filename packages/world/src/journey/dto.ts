/** Journey DTO for API responses (ADR-0015 §10). */

export interface JourneyDTO {
  readonly status: "started" | "completed" | "blocked";
  readonly from: string | null;
  readonly to: string | null;
  readonly elapsedTicks: number;
  readonly totalTicks: number;
  readonly text: string;
}
