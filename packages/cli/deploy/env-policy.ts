/**
 * Production containment policy for the opencode_run transport env.
 *
 * systemd `EnvironmentFile` honors quoted values, so a regex gate over the
 * raw text can be bypassed with `SKALD_OPENCODE_RUN="1"` (runtime sees `1`,
 * the pattern sees `"1"`). This helper parses the systemd subset instead and
 * decides fail-closed. Used by install/update-orange-pi.sh before any
 * mutation; behavior is pinned by env-policy.test.ts.
 *
 * Subset rules (documented, conservative where systemd is ambiguous):
 * - blank lines and `#`/`;` full-line comments are skipped;
 * - lines without `=` are ignored (systemd ignores them too);
 * - keys must match `[A-Za-z_][A-Za-z0-9_]*`, whitespace around `=` is allowed;
 * - values may be bare, `"double quoted"` (with `\"` and `\\` escapes) or
 *   `'single quoted'` (literal); only trailing whitespace may follow a
 *   closing quote;
 * - bare values run to end of line (inline `#` comments are NOT stripped —
 *   systemd keeps them as value text, so `RUN=1 # x` disables the transport
 *   in both the gate and the runtime; write plain `KEY=value` lines);
 * - any duplicate key or malformed line rejects the whole file: values never
 *   enter reports or logs (only offending key names do — names are not
 *   secrets, values stay out).
 *
 * CLI: `node --import tsx packages/cli/deploy/env-policy.ts [file]`
 * (stdin when omitted) prints one line and exits 0 on accept, 1 on reject.
 * A missing/unreadable file accepts: with no env content the transport
 * cannot be enabled through it.
 */

import { readFileSync } from "node:fs";

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ParsedEnv {
  readonly vars: ReadonlyMap<string, string>;
  readonly duplicates: readonly string[];
  readonly malformed: boolean;
}

/** Parse the systemd subset. Pure and total; never throws. */
export function parseEnvFile(text: string): ParsedEnv {
  const vars = new Map<string, string>();
  const duplicates: string[] = [];
  let malformed = false;
  const body = text.charCodeAt(0) === 65279 ? text.slice(1) : text; // leading BOM
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!KEY_RE.test(key)) {
      malformed = true;
      continue;
    }
    const parsed = parseEnvValue(line.slice(eq + 1).trimStart());
    if (parsed === undefined) {
      malformed = true;
      continue;
    }
    if (vars.has(key)) {
      if (!duplicates.includes(key)) duplicates.push(key);
      continue;
    }
    vars.set(key, parsed);
  }
  return { vars, duplicates: Object.freeze([...duplicates]), malformed };
}

/** Parse one right-hand side; undefined when malformed. */
function parseEnvValue(rest: string): string | undefined {
  if (rest.startsWith('"') || rest.startsWith("'")) {
    const quote = rest[0] as string;
    let out = "";
    let index = 1;
    let closed = false;
    while (index < rest.length) {
      const ch = rest[index] as string;
      if (quote === '"' && ch === "\\" && index + 1 < rest.length) {
        const next = rest[index + 1] as string;
        out += next === '"' || next === "\\" ? next : `\\${next}`;
        index += 2;
        continue;
      }
      if (ch === quote) {
        closed = true;
        index += 1;
        break;
      }
      out += ch;
      index += 1;
    }
    if (!closed) return undefined;
    if (rest.slice(index).trim() !== "") return undefined;
    return out;
  }
  return rest.trimEnd();
}

export interface EnvPolicy {
  readonly accepted: boolean;
  readonly reason: string;
}

/** Containment decision over file text. Pure; values never enter the reason. */
export function decideEnvPolicy(text: string): EnvPolicy {
  const parsed = parseEnvFile(text);
  if (parsed.malformed) {
    return { accepted: false, reason: "Containment env policy failed: malformed env line." };
  }
  if (parsed.duplicates.length > 0) {
    return { accepted: false, reason: `Containment env policy failed: duplicate keys: ${parsed.duplicates.join(",")}.` };
  }
  if (parsed.vars.get("SKALD_OPENCODE_RUN") !== "1") {
    return { accepted: true, reason: "Containment env policy holds: transport disabled." };
  }
  if (parsed.vars.get("SKALD_OPENCODE_ISOLATE_HOME") === "0") {
    return { accepted: false, reason: "Containment env policy failed: SKALD_OPENCODE_ISOLATE_HOME=0 is forbidden in production." };
  }
  const manifest = parsed.vars.get("SKALD_OPENCODE_AGENT_MANIFEST");
  if (manifest !== undefined && manifest !== "") {
    return { accepted: false, reason: "Containment env policy failed: SKALD_OPENCODE_AGENT_MANIFEST override is forbidden in production." };
  }
  return { accepted: true, reason: "Containment env policy holds." };
}

function main(): number {
  let text = "";
  try {
    const file = process.argv[2];
    text = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  } catch {
    const decision = { accepted: true, reason: "Containment env policy holds: no env content to enable the transport." };
    process.stdout.write(`${decision.reason}\n`);
    return 0;
  }
  const decision = decideEnvPolicy(text);
  process.stdout.write(`${decision.reason}\n`);
  return decision.accepted ? 0 : 1;
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("env-policy.ts");
if (invokedAsScript) {
  process.exitCode = main();
}
