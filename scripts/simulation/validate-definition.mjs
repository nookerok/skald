import { readFileSync, readdirSync } from 'fs';
import { parse } from 'yaml';
import { join } from 'path';

const DEFINITIONS_DIR = 'docs/simulation/definitions';

const LIFECYCLE_STATUSES = ['Proposal', 'Review', 'Experimental', 'Candidate', 'Core'];
const UPDATE_MODELS = ['Static', 'OnDemand', 'EventDriven', 'TickDriven'];
const BUDGET_CLASSES = ['Full', 'Aggregated', 'BootstrapOnly'];
const GUARANTEE_KINDS = ['invariant', 'conservation', 'impossibility'];
const GUARANTEE_SCOPES = ['aspect', 'system', 'interaction'];
const EVIDENCE_KINDS = ['Rule', 'Test', 'Lint', 'Review'];

function validateDefinition(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const doc = parse(content);
  const errors = [];
  const systemId = doc?.identity?.systemId;

  // 1. Required top-level sections
  const requiredSections = ['identity', 'publicContract', 'operationalProfile', 'privateDesign'];
  for (const section of requiredSections) {
    if (!doc[section]) errors.push(`[${systemId}] Missing required section: ${section}`);
  }

  // 2. Identity
  if (doc.identity) {
    if (!doc.identity.systemId) errors.push(`[${systemId}] identity.systemId is required`);
    if (!doc.identity.lifecycleStatus) errors.push(`[${systemId}] identity.lifecycleStatus is required`);
    if (doc.identity.lifecycleStatus && !LIFECYCLE_STATUSES.includes(doc.identity.lifecycleStatus)) {
      errors.push(`[${systemId}] Invalid lifecycleStatus: ${doc.identity.lifecycleStatus}. Allowed: ${LIFECYCLE_STATUSES.join(', ')}`);
    }
    if (!doc.identity.version) errors.push(`[${systemId}] identity.version is required`);
  }

  // 3. Public Contract
  if (doc.publicContract) {
    const pc = doc.publicContract;

    // Dependencies
    if (pc.dependencies) {
      const deps = pc.dependencies;
      if (!deps.ownedAspects || deps.ownedAspects.length === 0) {
        errors.push(`[${systemId}] publicContract.dependencies.ownedAspects must be non-empty`);
      }
      if (!Array.isArray(deps.dependsOn)) {
        errors.push(`[${systemId}] publicContract.dependencies.dependsOn must be an array`);
      }
      if (!Array.isArray(deps.influences)) {
        errors.push(`[${systemId}] publicContract.dependencies.influences must be an array`);
      }

      // dependencyEvidence format
      if (deps.influences) {
        for (const inf of deps.influences) {
          if (!inf.target) errors.push(`[${systemId}] influences entry missing 'target'`);
          if (!inf.dependencyEvidence || inf.dependencyEvidence.length === 0) {
            errors.push(`[${systemId}] influences entry for '${inf.target}' missing dependencyEvidence (V-08)`);
          }
        }
      }
    } else {
      errors.push(`[${systemId}] publicContract.dependencies is required`);
    }

    // Observable Surface
    if (pc.observableSurface) {
      const os = pc.observableSurface;
      if (!Array.isArray(os.emits)) errors.push(`[${systemId}] observableSurface.emits must be an array`);
      if (!Array.isArray(os.consumes)) errors.push(`[${systemId}] observableSurface.consumes must be an array`);
      if (!Array.isArray(os.hiddenAspects)) errors.push(`[${systemId}] observableSurface.hiddenAspects must be an array`);
    } else {
      errors.push(`[${systemId}] publicContract.observableSurface is required`);
    }

    // Guarantees
    if (pc.guarantees) {
      const ids = new Set();
      for (const g of pc.guarantees) {
        if (!g.id) { errors.push(`[${systemId}] guarantee missing 'id'`); continue; }
        if (ids.has(g.id)) errors.push(`[${systemId}] Duplicate guarantee id: ${g.id}`);
        ids.add(g.id);

        if (!g.statement) errors.push(`[${systemId}] guarantee '${g.id}' missing 'statement'`);
        if (!GUARANTEE_KINDS.includes(g.kind)) {
          errors.push(`[${systemId}] guarantee '${g.id}' invalid kind: ${g.kind}. Allowed: ${GUARANTEE_KINDS.join(', ')}`);
        }
        if (!GUARANTEE_SCOPES.includes(g.scope)) {
          errors.push(`[${systemId}] guarantee '${g.id}' invalid scope: ${g.scope}. Allowed: ${GUARANTEE_SCOPES.join(', ')}`);
        }

        // implementationEvidence
        if (!g.implementationEvidence || g.implementationEvidence.length === 0) {
          errors.push(`[${systemId}] guarantee '${g.id}' missing implementationEvidence (V-05 Hollow Guarantee)`);
        } else {
          for (const ev of g.implementationEvidence) {
            if (!EVIDENCE_KINDS.includes(ev.kind)) {
              errors.push(`[${systemId}] guarantee '${g.id}' implementationEvidence invalid kind: ${ev.kind}. Allowed: ${EVIDENCE_KINDS.join(', ')}`);
            }
            if (!ev.ref) {
              errors.push(`[${systemId}] guarantee '${g.id}' implementationEvidence missing 'ref'`);
            }
          }
        }
      }
    } else {
      errors.push(`[${systemId}] publicContract.guarantees is required`);
    }
  }

  // 4. Operational Profile
  if (doc.operationalProfile) {
    const op = doc.operationalProfile;
    if (!UPDATE_MODELS.includes(op.updateModel)) {
      errors.push(`[${systemId}] Invalid updateModel: ${op.updateModel}. Allowed: ${UPDATE_MODELS.join(', ')}`);
    }
    if (op.budget) {
      if (!Array.isArray(op.budget.supports)) {
        errors.push(`[${systemId}] operationalProfile.budget.supports must be an array`);
      } else {
        for (const b of op.budget.supports) {
          if (!BUDGET_CLASSES.includes(b)) {
            errors.push(`[${systemId}] Invalid budget class: ${b}. Allowed: ${BUDGET_CLASSES.join(', ')}`);
          }
        }
      }
    }
    if (op.persistenceReplay) {
      if (!Array.isArray(op.persistenceReplay.replayAssumptions)) {
        errors.push(`[${systemId}] operationalProfile.persistenceReplay.replayAssumptions must be an array`);
      }
    }
  }

  // 5. Private Design
  if (doc.privateDesign) {
    if (!doc.privateDesign.stateSemantics) {
      errors.push(`[${systemId}] privateDesign.stateSemantics is required`);
    }
    if (!doc.privateDesign.parameterSlots || doc.privateDesign.parameterSlots.length === 0) {
      errors.push(`[${systemId}] privateDesign.parameterSlots must be non-empty`);
    }
  }

  // 6. No invented fields at top level
  const allowedTopLevel = ['identity', 'publicContract', 'operationalProfile', 'privateDesign'];
  for (const key of Object.keys(doc)) {
    if (key.startsWith('#')) continue; // comments
    if (!allowedTopLevel.includes(key)) {
      errors.push(`[${systemId}] Invented top-level field: '${key}' (Review №1 rec: remove invented fields)`);
    }
  }

  return errors;
}

function main() {
  const files = readdirSync(DEFINITIONS_DIR).filter(f => f.endsWith('.yaml'));
  let totalErrors = 0;

  for (const file of files) {
    const path = join(DEFINITIONS_DIR, file);
    const errors = validateDefinition(path);
    if (errors.length === 0) {
      console.log(`✅ ${file} — valid`);
    } else {
      console.log(`❌ ${file} — ${errors.length} error(s):`);
      for (const err of errors) console.log(`   ${err}`);
      totalErrors += errors.length;
    }
  }

  console.log(`\n---`);
  console.log(`Files checked: ${files.length}`);
  console.log(`Total errors: ${totalErrors}`);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
