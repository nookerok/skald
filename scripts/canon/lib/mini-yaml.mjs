// Transitional minimal YAML subset parser for the Canon Model (ADR-0021).
//
// The repository has no YAML dependency today, and A-27 forbids adding
// infrastructure before it is needed. This parser supports exactly the
// restricted subset used by docs/canon/**.yaml:
//   - block mappings with consistent 2-space indentation
//   - block sequences introduced by "- " (scalars or inline-started maps)
//   - nested blocks under an empty "key:"
//   - scalars: double-quoted strings (JSON escapes), single-quoted strings,
//     plain scalars, true/false/null, numbers, empty [] and {}
//   - full-line comments starting with #
// NOT supported (keep Canon files away from these): inline comments, anchors,
// tags, multiline scalars, flow collections with entries, tabs.
//
// Replacement target: the shared contract implementation (zod + a real YAML
// parser) when Canon contracts move to packages/canon (ADR-0021 decision 2).

const KEY_RE = /^[A-Za-z0-9_.-]+:(\s|$)/;

function splitKeyValue(content) {
  const match = content.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
  if (!match) {
    throw new Error(`Expected "key: value", got: ${content}`);
  }
  const value = match[2].trim();
  return { key: match[1], value: value === "" ? null : value };
}

function isKeyValue(content) {
  return KEY_RE.test(content);
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`Invalid double-quoted scalar: ${value}`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw new Error(`Invalid single-quoted scalar: ${value}`);
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function parseYaml(text, sourceName = "<input>") {
  const rows = [];
  const physical = text.replace(/\r\n/g, "\n").split("\n");
  for (const raw of physical) {
    if (!raw.trim()) continue;
    const trimmedStart = raw.trimStart();
    if (trimmedStart.startsWith("#")) continue;
    const indent = raw.length - trimmedStart.length;
    if (raw.slice(0, indent).includes("\t")) {
      throw new Error(`${sourceName}: tabs are not allowed in Canon YAML`);
    }
    rows.push({ indent, content: raw.trimEnd().slice(indent) });
  }

  let pos = 0;
  const peek = () => rows[pos];
  const fail = (message) => {
    const row = rows[pos];
    throw new Error(`${sourceName}:${pos + 1} ${message}${row ? ` near: ${row.content}` : ""}`);
  };

  function parseBlock(indent) {
    const first = peek();
    if (!first || first.indent < indent) return null;
    if (first.content === "-" || first.content.startsWith("- ")) {
      return parseSequence(indent);
    }
    return parseMapping(indent);
  }

  function parseMapping(indent) {
    const result = {};
    while (pos < rows.length) {
      const row = rows[pos];
      if (row.indent < indent) break;
      if (row.indent > indent) fail("unexpected indentation");
      if (row.content === "-" || row.content.startsWith("- ")) break;
      assignPair(result, row.content, indent);
    }
    return result;
  }

  function parseSequence(indent) {
    const result = [];
    while (pos < rows.length) {
      const row = rows[pos];
      if (row.indent < indent) break;
      if (row.indent > indent) fail("unexpected indentation");
      if (!(row.content === "-" || row.content.startsWith("- "))) break;
      const rest = row.content === "-" ? "" : row.content.slice(2).trim();
      if (rest === "") {
        pos++;
        const next = peek();
        result.push(next && next.indent > indent ? parseBlock(next.indent) : null);
        continue;
      }
      if (isKeyValue(rest)) {
        const item = {};
        const childIndent = indent + 2;
        assignPair(item, rest, childIndent);
        while (pos < rows.length) {
          const nextRow = rows[pos];
          if (nextRow.indent !== childIndent) break;
          if (nextRow.content === "-" || nextRow.content.startsWith("- ")) break;
          if (!isKeyValue(nextRow.content)) break;
          assignPair(item, nextRow.content, childIndent);
        }
        result.push(item);
        continue;
      }
      pos++;
      result.push(parseScalar(rest));
    }
    return result;
  }

  function assignPair(target, content, indent) {
    const { key, value } = splitKeyValue(content);
    pos++;
    if (value === null) {
      const next = peek();
      target[key] = next && next.indent > indent ? parseBlock(next.indent) : null;
    } else {
      target[key] = parseScalar(value);
    }
  }

  if (rows.length === 0) return null;
  return parseBlock(rows[0].indent);
}
