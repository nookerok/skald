import { existsSync } from "node:fs";
import { reportRegionAuthoring } from "./authoring-tools.mjs";
const fileIndex = process.argv.indexOf("--file");
const file = fileIndex >= 0 ? process.argv[fileIndex + 1] : null;
if (file && !existsSync(file)) throw new Error("file not found: " + file);
console.log(JSON.stringify({ file, ...reportRegionAuthoring() }));
