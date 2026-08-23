/**
 * Typed provider-level error raised when an LLM provider explicitly refuses
 * or is unavailable for a non-transient reason (deliberate failure, explicit
 * rejection, model offline, etc.). Carries provider/model metadata for
 * diagnostics without exposing technical details to player-facing DTOs.
 */

import type { ProviderId } from "./types.js";

export const PROVIDER_UNAVAILABLE_CODE = "PROVIDER_UNAVAILABLE" as const;

export class ProviderUnavailableError extends Error {
  readonly code = PROVIDER_UNAVAILABLE_CODE;
  readonly provider: ProviderId;
  readonly model: string;
  readonly configuredModel: string;

  constructor(
    message: string,
    opts: {
      provider: ProviderId;
      model: string;
      configuredModel: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: opts.cause });
    this.name = "ProviderUnavailableError";
    this.provider = opts.provider;
    this.model = opts.model;
    this.configuredModel = opts.configuredModel;
  }
}
