#!/usr/bin/env node
// Volume gate for the theming rollout (THEME-SPEC §6a): ~1,900+ hardcoded-literal
// replacements is too much for a Playwright visual walk to catch every mistyped
// fallback, so every `var(--ks-*, <fallback>)` in src/ is checked mechanically
// against the dark column of tokens/ks-tokens.json before a ksui publish.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(rootDir, "src");
const tokensPath = path.join(rootDir, "tokens", "ks-tokens.json");
const scannedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else if (scannedExtensions.has(path.extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

// Extracts `var(--ks-<name>, <fallback>)` occurrences with balanced-paren
// fallback parsing (fallbacks like `rgba(0,0,0,0.4)` contain their own parens).
function extractVarRefs(source) {
  const refs = [];
  const marker = "var(--ks-";
  let searchFrom = 0;
  for (;;) {
    const start = source.indexOf(marker, searchFrom);
    if (start === -1) break;
    const nameStart = start + 4; // position right after "var("
    let cursor = nameStart;
    while (cursor < source.length && /[a-zA-Z0-9-]/.test(source[cursor])) cursor++;
    const varName = source.slice(nameStart, cursor);

    // Skip whitespace, then a comma introduces the fallback; no comma means
    // a bare `var(--ks-x)` reference with nothing to check.
    let i = cursor;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] !== ",") {
      searchFrom = cursor;
      continue;
    }
    i++; // past comma
    while (i < source.length && /\s/.test(source[i])) i++;

    let depth = 1;
    const fallbackStart = i;
    while (i < source.length && depth > 0) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
      if (depth > 0) i++;
    }
    const fallback = source.slice(fallbackStart, i).trim();
    refs.push({ varName, fallback, index: start });
    searchFrom = i + 1;
  }
  return refs;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function main() {
  const { tokens } = JSON.parse(readFileSync(tokensPath, "utf8"));
  const darkByVar = new Map(tokens.map((t) => [t.cssVar, t.darkValue]));

  const mismatches = [];
  for (const file of walk(srcDir)) {
    const source = readFileSync(file, "utf8");
    for (const ref of extractVarRefs(source)) {
      const expected = darkByVar.get(ref.varName);
      // A fallback that is itself another var(...) chain (the 3-level
      // old-name → new-token → dark-literal pattern, §1.4) is not this
      // token's own fallback — the inner var() gets matched on its own pass.
      if (expected === undefined || ref.fallback.startsWith("var(")) continue;
      if (ref.fallback !== expected) {
        mismatches.push({
          file: path.relative(rootDir, file),
          line: lineOf(source, ref.index),
          varName: ref.varName,
          fallback: ref.fallback,
          expected,
        });
      }
    }
  }

  if (mismatches.length > 0) {
    console.error(`check:tokens — ${mismatches.length} fallback mismatch(es):\n`);
    for (const m of mismatches) {
      console.error(`  ${m.file}:${m.line}  var(${m.varName}, "${m.fallback}")`);
      console.error(`    expected dark default: "${m.expected}"\n`);
    }
    process.exit(1);
  }

  console.log("check:tokens — all var(--ks-*, <fallback>) references match their dark default.");
}

main();
