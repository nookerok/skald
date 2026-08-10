import { initReferenceArtifact } from "./authoring-tools.mjs";
const args = process.argv.slice(2);
const imageIndex = args.indexOf("--image");
const regionIndex = args.indexOf("--region");
const image = imageIndex >= 0 ? args[imageIndex + 1] : args[0];
const region = regionIndex >= 0 ? args[regionIndex + 1] : "pilot-region";
console.log(JSON.stringify(initReferenceArtifact(image, region)));
