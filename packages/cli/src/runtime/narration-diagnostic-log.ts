import type { NarrationDiagnosticEvent, NarrationDiagnosticSink } from "@skald/world";

/**
 * Bounded in-memory operational log for narration diagnostics.
 *
 * Diagnostics are read-side telemetry: they are not persisted, replayed into
 * WorldState, or exposed through player-facing DTOs.
 */
export class NarrationDiagnosticLog {
  private readonly events: NarrationDiagnosticEvent[] = [];

  constructor(private readonly maxEntries = 256) {}

  record(event: NarrationDiagnosticEvent): void {
    this.events.push(Object.freeze({ ...event }));
    while (this.events.length > this.maxEntries) this.events.shift();
  }

  sink(): NarrationDiagnosticSink {
    return (event) => this.record(event);
  }

  snapshot(): readonly NarrationDiagnosticEvent[] {
    return this.events.slice();
  }
}
