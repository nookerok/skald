import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.mjs";

export function sha256(value) {
  const input = typeof value === "string" ? value : canonicalJson(value);
  return createHash("sha256").update(input).digest("hex");
}
