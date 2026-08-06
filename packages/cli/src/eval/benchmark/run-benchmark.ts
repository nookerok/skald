/**
 * Transcript Benchmark consensus comparator (packages/cli/src/eval/benchmark/run-benchmark.ts).
 *
 * Usage:
 *   node --import tsx packages/cli/src/eval/benchmark/run-benchmark.ts answers.json
 *
 * Input: an array of structured answers (one per model) that analysed the SAME
 * transcript artifact. `analyzeAnswers` is the pure, testable core: an item is
 * CONSENSUS when at least two distinct models independently mention it (a
 * strong signal of a real interface problem), DIVERGENT when only one saw it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Answer {
  model: string;
  understanding: string;
  missingInfo: string[];
  interfaceIssues: string[];
  improvements: string[];
  expectedNextEvents: string[];
}

export interface ConsensusEntry {
  readonly count: number;
  readonly models: readonly string[];
  readonly raw: string;
}

export interface BenchmarkReport {
  readonly models: readonly string[];
  readonly consensus: Record<string, readonly ConsensusEntry[]>;
  readonly divergent: Record<string, readonly { item: string; model: string }[]>;
  readonly understandings: readonly { model: string; understanding: string }[];
  readonly consensusCount: number;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-zа-яё0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

export function analyzeAnswers(answers: readonly Answer[]): BenchmarkReport {
  const cluster = (field: keyof Pick<Answer, "missingInfo" | "interfaceIssues" | "improvements" | "expectedNextEvents">) => {
    const mentions = new Map<string, { count: number; models: string[]; raw: string }>();
    for (const answer of answers) {
      for (const item of answer[field] ?? []) {
        const key = normalize(item);
        if (!key) continue;
        const entry = mentions.get(key) ?? { count: 0, models: [], raw: item };
        entry.count++;
        if (!entry.models.includes(answer.model)) entry.models.push(answer.model);
        mentions.set(key, entry);
      }
    }
    return [...mentions.values()].sort((a, b) => b.count - a.count);
  };

  const consensus: Record<string, readonly ConsensusEntry[]> = {};
  const divergent: Record<string, readonly { item: string; model: string }[]> = {};
  for (const field of ["missingInfo", "interfaceIssues", "improvements", "expectedNextEvents"] as const) {
    const entries = cluster(field);
    consensus[field] = entries.filter((e) => e.count >= 2);
    divergent[field] = entries.filter((e) => e.count === 1).map((e) => ({ item: e.raw, model: e.models[0]! }));
  }

  const consensusCount = Object.values(consensus).reduce((sum, list) => sum + list.length, 0);
  return {
    models: answers.map((a) => a.model),
    consensus,
    divergent,
    understandings: answers.map((a) => ({ model: a.model, understanding: a.understanding })),
    consensusCount,
  };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: run-benchmark.ts <answers.json>");
    process.exit(2);
  }
  const answers = JSON.parse(readFileSync(file, "utf8")) as Answer[];
  if (!Array.isArray(answers) || answers.length === 0) {
    console.error("[benchmark] answers.json must be a non-empty array of model answers");
    process.exit(2);
  }
  const report = analyzeAnswers(answers);
  console.log("[benchmark] models:", report.models.join(", "));
  for (const field of ["missingInfo", "interfaceIssues", "improvements", "expectedNextEvents"] as const) {
    console.log(`--- ${field} ---`);
    for (const entry of report.consensus[field]) console.log(`  CONSENSUS (${entry.models.length} models): ${entry.raw}`);
    for (const entry of report.divergent[field]) console.log(`  divergent (${entry.model}): ${entry.item}`);
    if (report.consensus[field].length === 0 && report.divergent[field].length === 0) console.log("  (none)");
  }
  console.log(`[benchmark] consensus items: ${report.consensusCount}`);
  console.log(JSON.stringify(report, null, 2));
}
