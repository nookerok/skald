import { createHash } from "node:crypto";
import { narrationKey } from "@skald/world";

/** Opaque read-side reference: never a Domain Event or database identifier. */
export function readSideHandle(kind: "turn" | "thread", key: string): string {
  return createHash("sha256").update(JSON.stringify([kind, key])).digest("hex");
}

/** Shared by a transcript answer, its journal decoration, and browser polling. */
export function narrationHandle(worldTime: number, correlationId?: string): string {
  return readSideHandle("turn", String(narrationKey(worldTime, correlationId)));
}
