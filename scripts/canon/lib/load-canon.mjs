// Shared Canon Model loader for canon tooling (ADR-0021).
// Walks docs/canon, parses every .yaml with the transitional mini-YAML parser
// and classifies documents by their top-level key:
//   concept  -> docs/canon/universal|regions/**
//   anchors  -> docs/canon/anchors/**
//   claims   -> docs/canon/not-simulated/**
//   tools    -> docs/canon/deferred/**
// Pure read-side utility: no writes, no network, no clock dependence.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseYaml } from "./mini-yaml.mjs";

export const CANON_ROOT = "docs/canon";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "schema") continue;
      out.push(...walk(full));
    } else if (entry.endsWith(".yaml")) {
      out.push(full);
    }
  }
  return out;
}

export function loadCanon(rootDir = CANON_ROOT) {
  const documents = [];
  const errors = [];
  let files = [];
  try {
    files = walk(rootDir);
  } catch {
    errors.push(`canon root not found: ${rootDir}`);
    return { documents, errors };
  }
  for (const file of files.sort()) {
    const rel = relative(".", file).replace(/\\/g, "/");
    try {
      const data = parseYaml(readFileSync(file, "utf8"), rel);
      const kind = data?.concept
        ? "concept"
        : data?.anchors
          ? "anchors"
          : data?.claims
            ? "claims"
            : data?.tools
              ? "tools"
              : "unknown";
      documents.push({ file: rel, kind, data });
    } catch (error) {
      errors.push(`${rel}: ${error.message}`);
    }
  }
  return { documents, errors };
}
