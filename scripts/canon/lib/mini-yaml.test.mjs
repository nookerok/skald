// Regression self-test for the mini-YAML parser (scripts/canon/lib/mini-yaml.mjs).
//
// Guard against the silent-field-loss bug: an inline-started sequence item
// (`- id: value` followed by indented keys) used to drop its FIRST child key
// (`statement`, `conceptId`, ...) because parseSequence advanced the cursor
// before assignPair advanced it again. Run as part of npm run canon:validate.

import assert from "node:assert/strict";
import { parseYaml } from "./mini-yaml.mjs";

const cases = [
  {
    name: "sequence item with inline key keeps its first scalar child",
    yaml: [
      "facts:",
      "  - id: a.b.f1",
      "    statement: \"first child scalar\"",
      "    type: Causal",
      "  - id: a.b.f2",
      "    statement: \"second item\"",
    ].join("\n"),
    check: (doc) => {
      assert.equal(doc.facts.length, 2, "two facts parsed");
      assert.equal(doc.facts[0].id, "a.b.f1");
      assert.equal(doc.facts[0].statement, "first child scalar");
      assert.equal(doc.facts[0].type, "Causal");
      assert.equal(doc.facts[1].statement, "second item");
    },
  },
  {
    name: "sequence item whose first child is a nested block",
    yaml: [
      "items:",
      "  - id: x",
      "    meta:",
      "      scale: Eternal",
      "      mutation: Immutable",
      "    value: 7",
    ].join("\n"),
    check: (doc) => {
      assert.deepEqual(doc.items[0].meta, { scale: "Eternal", mutation: "Immutable" });
      assert.equal(doc.items[0].value, 7);
    },
  },
  {
    name: "scalar-only sequence still parses",
    yaml: ["events:", "  - \"A\"", "  - \"B\""].join("\n"),
    check: (doc) => assert.deepEqual(doc.events, ["A", "B"]),
  },
  {
    name: "empty sequence value and nested sequences",
    yaml: [
      "rules: []",
      "mapping:",
      "  list:",
      "    - id: y",
      "      consequences:",
      "        - \"one\"",
      "        - \"two\"",
    ].join("\n"),
    check: (doc) => {
      assert.deepEqual(doc.rules, []);
      assert.deepEqual(doc.mapping.list[0].consequences, ["one", "two"]);
    },
  },
];

let failures = 0;
for (const { name, yaml, check } of cases) {
  try {
    const doc = parseYaml(yaml, name);
    check(doc);
    console.log(`[mini-yaml.test] ok: ${name}`);
  } catch (error) {
    failures++;
    console.error(`[mini-yaml.test] FAIL: ${name}: ${error.message}`);
  }
}

if (failures > 0) {
  console.error(`[mini-yaml.test] FAIL (${failures} failure(s))`);
  process.exit(1);
}
console.log("[mini-yaml.test] PASS");
