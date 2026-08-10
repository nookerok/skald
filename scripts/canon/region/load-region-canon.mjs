import { resolve } from 'node:path';
import { loadCanon } from '../lib/load-canon.mjs';

export function listRegionIds(rootDir = process.cwd()) {
  const loaded = loadCanon(resolve(rootDir, "docs/canon"));
  if (loaded.errors.length) throw new Error(loaded.errors.join("; "));
  return [...new Set(loaded.documents.filter((doc) => doc.kind === "compilerProjection").map((doc) => doc.data.compilerProjection?.regionId).filter((id) => typeof id === "string"))].sort();
}

export function loadRegionCanon(rootDir = process.cwd(), regionId = null) {
  const loaded = loadCanon(resolve(rootDir, 'docs/canon'));
  if (loaded.errors.length) throw new Error(loaded.errors.join('; '));
  const projections = loaded.documents.filter((doc) => doc.kind === 'compilerProjection').map((doc) => ({ file: doc.file, projection: doc.data.compilerProjection }));
  if (projections.length === 0) throw new Error('no compilerProjection document found');
  const selected = regionId ? projections.find((entry) => entry.projection?.regionId === regionId) : projections[0];
  if (!selected?.projection) throw new Error('compiler projection not found: ' + regionId);
  const canonIds = new Set();
  for (const document of loaded.documents) {
    const root = document.data?.concept ?? document.data?.anchors ?? document.data?.claims;
    if (root?.id) canonIds.add(root.id);
    for (const fact of root?.facts ?? []) if (fact.id) canonIds.add(fact.id);
    for (const anchor of root?.items ?? []) if (anchor.id) canonIds.add(anchor.id);
  }
  for (const ref of selected.projection.canonicalRefs ?? []) if (!canonIds.has(ref)) throw new Error('compiler projection references unknown Canon id: ' + ref);
  return { projection: selected.projection, sourceFile: selected.file, canonIds, documents: loaded.documents };
}
