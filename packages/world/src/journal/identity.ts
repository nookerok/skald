/** Read-side narration identity. Numeric keys are pre-correlation legacy rows. */
export function narrationKey(worldTime: number, correlationId?: string): number | string {
  return correlationId ? JSON.stringify([worldTime, correlationId]) : worldTime;
}
