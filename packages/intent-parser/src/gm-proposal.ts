/**
 * Director proposal adapter. The wire uses opaque scene handles in the
 * existing TurnProposalV2 ref slots; only the server binds them back.
 * No new execution language or world authority is introduced.
 */
import { parseTurnProposal, type TurnProposalV2 } from "./turn-proposal.js";

function mapReferences(raw: unknown, resolve: (handle: string) => string | undefined): unknown {
  if (Array.isArray(raw)) return raw.map((value) => mapReferences(value, resolve));
  if (raw === null || typeof raw !== "object") return raw;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) {
    if (key === "observerRef") {
      if (typeof value !== "string") throw new Error("invalid reference");
      const ref = resolve(value);
      if (!ref) throw new Error("unknown handle");
      result[key] = ref;
    } else if (key === "members") {
      if (!Array.isArray(value)) throw new Error("invalid group");
      result[key] = value.map((member) => {
        if (typeof member !== "string") throw new Error("invalid member");
        const ref = resolve(member);
        if (!ref) throw new Error("unknown member");
        return ref;
      });
    } else {
      result[key] = mapReferences(value, resolve);
    }
  }
  return result;
}

/**
 * Check the closed V2 shape without exposing scene refs to the model.
 * Synthetic refs are used ONLY for syntax checking, never execution.
 */
export function parseGmProposal(raw: unknown, allowedHandles?: readonly string[]): TurnProposalV2 | null {
  const syntaxRefs = new Map<string, string>();
  try {
    const shape = mapReferences(raw, (handle) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(handle)
        || /^(person|object|route|topic)_[0-9]+$/.test(handle)
        || (allowedHandles && !allowedHandles.includes(handle))) return undefined;
      if (!syntaxRefs.has(handle)) syntaxRefs.set(handle, "person_" + (syntaxRefs.size + 1));
      return syntaxRefs.get(handle);
    });
    return parseTurnProposal(shape) ? raw as TurnProposalV2 : null;
  } catch {
    return null;
  }
}

/** Resolve every declared handle against the server-owned scene map, fail closed. */
export function bindGmProposal(proposal: TurnProposalV2, handleToObserverRef: ReadonlyMap<string, string>): TurnProposalV2 | null {
  try {
    return parseTurnProposal(mapReferences(proposal, (handle) => handleToObserverRef.get(handle)));
  } catch {
    return null;
  }
}
