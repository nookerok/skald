import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { validateRegionAuthoring } from "../validate-region-authoring.mjs";

const root = resolve(process.cwd());
const referenceDir = resolve(root, "docs/worldbuilding/pilot-region/reference");

function dimensions(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error("reference must be a PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function initReferenceArtifact(sourcePath, regionId = "pilot-region") {
  if (!sourcePath) throw new Error("usage: node init-reference-artifact.mjs --image <png-path> --region <region-id>");
  const source = readFileSync(resolve(sourcePath));
  const { width, height } = dimensions(source);
  const digest = createHash("sha256").update(source).digest("hex");
  mkdirSync(referenceDir, { recursive: true });
  copyFileSync(resolve(sourcePath), resolve(referenceDir, "region-source.png"));
  const manifest = `schemaVersion: 1\nartifact:\n  id: ${regionId}-reference-001\n  role: reference_artifact\n  mediaType: image/png\n  file:\n    path: region-source.png\n    sha256: ${digest}\n    widthPx: ${width}\n    heightPx: ${height}\n  provenance:\n    authoringOnly: true\n    runtimeAllowed: false\n    sourceKind: user_supplied_reference\n    receivedAt: "2026-08-09"\n`;
  writeFileSync(resolve(referenceDir, "artifact-manifest.yaml"), manifest);
  return { digest, width, height };
}

export function reportRegionAuthoring() {
  const result = validateRegionAuthoring(root);
  if (result.errors.length) throw new Error(result.errors.join("; "));
  return result.counts;
}

