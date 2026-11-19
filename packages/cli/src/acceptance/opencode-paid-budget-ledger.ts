/**
 * Safe, append-only reservations against the operator-authorized OpenCode
 * acceptance budget. Unknown provider billing stays reserved rather than
 * being treated as free.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { OpenCodeGenerationReservation } from "./opencode-live-budget.js";

export interface OpenCodePaidBudgetSnapshot {
  readonly authorizedUsd: number;
  readonly reservedUsd: number;
  readonly remainingUsd: number;
}

interface OpenCodePaidBudgetLedger {
  readonly schema: "SKALD_OPERATOR_PAID_BUDGET_V1";
  readonly authorizedUsd: number;
  readonly reservedTotalUsd: number;
  readonly remainingUnreservedUsd: number;
  readonly entries: readonly Record<string, unknown>[];
  readonly [key: string]: unknown;
}

const USD_UNITS_PER_DOLLAR = 100_000_000;

function usdUnits(value: number): number {
  const units = Math.round(value * USD_UNITS_PER_DOLLAR);
  if (!Number.isSafeInteger(units) || units < 0
    || Math.abs(value - units / USD_UNITS_PER_DOLLAR) > 1e-10) {
    throw new Error("paid budget ledger amount exceeds supported USD precision");
  }
  return units;
}

function parseLedger(path: string): OpenCodePaidBudgetLedger {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("paid budget ledger must be a regular file");
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("paid budget ledger is malformed");
  }
  const ledger = value as Record<string, unknown>;
  if (ledger["schema"] !== "SKALD_OPERATOR_PAID_BUDGET_V1"
    || typeof ledger["authorizedUsd"] !== "number" || !Number.isFinite(ledger["authorizedUsd"])
    || ledger["authorizedUsd"] < 0
    || !Array.isArray(ledger["entries"])
    || typeof ledger["reservedTotalUsd"] !== "number" || !Number.isFinite(ledger["reservedTotalUsd"])
    || typeof ledger["remainingUnreservedUsd"] !== "number" || !Number.isFinite(ledger["remainingUnreservedUsd"])) {
    throw new Error("paid budget ledger is malformed");
  }
  const entries = ledger["entries"] as unknown[];
  let sumUnits = 0;
  for (const entryValue of entries) {
    if (typeof entryValue !== "object" || entryValue === null || Array.isArray(entryValue)) {
      throw new Error("paid budget ledger entry is malformed");
    }
    const amount = (entryValue as Record<string, unknown>)["reservedUsd"];
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      throw new Error("paid budget ledger entry has an invalid reservation");
    }
    sumUnits += usdUnits(amount);
  }
  const authorizedUsd = ledger["authorizedUsd"];
  const reservedUsd = ledger["reservedTotalUsd"];
  const remainingUsd = ledger["remainingUnreservedUsd"];
  const authorizedUnits = usdUnits(authorizedUsd);
  const reservedUnits = usdUnits(reservedUsd);
  const remainingUnits = usdUnits(remainingUsd);
  if (sumUnits !== reservedUnits
    || authorizedUnits - reservedUnits !== remainingUnits
    || reservedUnits > authorizedUnits) {
    throw new Error("paid budget ledger totals do not match its reservations");
  }
  return ledger as unknown as OpenCodePaidBudgetLedger;
}

/** Read and reconcile the explicit operator spend ledger without changing it. */
export function readOpenCodePaidBudgetLedger(path: string): OpenCodePaidBudgetSnapshot {
  const ledger = parseLedger(path);
  return Object.freeze({
    authorizedUsd: ledger.authorizedUsd,
    reservedUsd: ledger.reservedTotalUsd,
    remainingUsd: Math.max(0, ledger.remainingUnreservedUsd),
  });
}

function atomicWrite(path: string, value: OpenCodePaidBudgetLedger): void {
  const directory = dirname(path);
  const dirStat = lstatSync(directory);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
    throw new Error("paid budget ledger directory must be a real directory");
  }
  const temporary = path + "." + randomUUID() + ".tmp";
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* preserve original failure */ }
    throw error;
  }
}

/**
 * Persist one worst-case reservation under an exclusive lock before the
 * corresponding provider generation request is sent.
 */
export function reserveOpenCodePaidBudget(
  path: string,
  runId: string,
  reservation: OpenCodeGenerationReservation,
): OpenCodePaidBudgetSnapshot {
  if (!/^[A-Za-z0-9_-]{1,80}$/u.test(runId)
    || !Number.isSafeInteger(reservation.generationRequest) || reservation.generationRequest < 1
    || !Number.isFinite(reservation.reservedUsd) || reservation.reservedUsd < 0
    || !Number.isSafeInteger(reservation.maxInputTokens) || reservation.maxInputTokens < 1
    || !Number.isSafeInteger(reservation.maxOutputTokens) || reservation.maxOutputTokens < 1
    || !Number.isFinite(reservation.inputPricePerMillionUsd) || reservation.inputPricePerMillionUsd < 0
    || !Number.isFinite(reservation.outputPricePerMillionUsd) || reservation.outputPricePerMillionUsd < 0
    || !/^[A-Za-z0-9._:/-]{1,400}$/u.test(reservation.model)) {
    throw new Error("paid budget reservation is invalid");
  }

  const lockPath = path + ".lock";
  let lock: number;
  try {
    lock = openSync(lockPath, "wx", 0o600);
  } catch {
    throw new Error("paid budget ledger is locked or unavailable");
  }
  try {
    const ledger = parseLedger(path);
    const id = runId + "-generation-" + reservation.generationRequest;
    if (ledger.entries.some((entry) => entry["id"] === id)) {
      throw new Error("paid budget reservation id already exists");
    }
    const reservedTotalUnits = usdUnits(ledger.reservedTotalUsd) + usdUnits(reservation.reservedUsd);
    const authorizedUnits = usdUnits(ledger.authorizedUsd);
    if (reservedTotalUnits > authorizedUnits) {
      throw new Error("operator-authorized paid budget is exhausted");
    }
    const reservedTotalUsd = reservedTotalUnits / USD_UNITS_PER_DOLLAR;
    const remainingUnreservedUsd = (authorizedUnits - reservedTotalUnits) / USD_UNITS_PER_DOLLAR;
    const entry: Record<string, unknown> = {
      id,
      model: reservation.model,
      status: "reserved_before_generation",
      reservedUsd: reservation.reservedUsd,
      inputPricePerMillionUsd: reservation.inputPricePerMillionUsd,
      outputPricePerMillionUsd: reservation.outputPricePerMillionUsd,
      maxInputTokens: reservation.maxInputTokens,
      configuredMaxOutputTokens: reservation.maxOutputTokens,
      callerGenerationLimit: 1,
      actualChargedUsd: null,
    };
    const next = Object.freeze({
      ...ledger,
      entries: Object.freeze([...ledger.entries, Object.freeze(entry)]),
      reservedTotalUsd,
      remainingUnreservedUsd,
    });
    atomicWrite(path, next);
    return Object.freeze({ authorizedUsd: ledger.authorizedUsd, reservedUsd: reservedTotalUsd, remainingUsd: remainingUnreservedUsd });
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}
