import { readFile } from "node:fs/promises";
import { validateAdventurePlaytestReview } from "./playtest-review.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run acceptance:adventure:review -- <review.json>");
  process.exitCode = 2;
} else {
  try {
    const review = JSON.parse(await readFile(path, "utf8")) as Parameters<typeof validateAdventurePlaytestReview>[0];
    const result = validateAdventurePlaytestReview(review);
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    console.error(`Unable to read playtest review: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

