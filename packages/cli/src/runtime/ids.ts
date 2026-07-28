export function commandEventId(correlationId: string, type: string): string {
  return `ev-${type}-${correlationId}`;
}
