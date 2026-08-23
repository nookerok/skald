import type { NarrationDiagnosticEvent, NarrationDiagnosticSink } from "@skald/world";

/**
 * Production default diagnostics sink: emits structured one-line JSON to
 * console.error. Best-effort: exceptions inside the sink are swallowed so
 * they never affect narration or command processing. The in-memory
 * NarrationDiagnosticLog remains an additional buffer for trusted surfaces.
 */
export function createProductionDiagnosticSink(): NarrationDiagnosticSink {
  return (event: NarrationDiagnosticEvent): void => {
    try {
      const frozen = Object.freeze({
        ...event,
        recordedAt: event.recordedAt ?? new Date().toISOString(),
      });
      console.error(JSON.stringify(frozen));
    } catch {
      // Best-effort: swallow to avoid affecting narration.
    }
  };
}
