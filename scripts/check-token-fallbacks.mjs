#!/usr/bin/env node
// Volume gate for the theming rollout (THEME-SPEC §6a): ~1,900+ hardcoded-literal
// replacements is too much for a Playwright visual walk to catch every mistyped
// fallback, so every `var(--ks-*, <fallback>)` in src/ is checked mechanically
// against the dark column of tokens/ks-tokens.json before a ksui publish.
//
// Also validates the color-mix(...) alpha-variant form (§6a Wave A.2 addendum,
// derived-color policy rule 1): color-mix(in srgb, var(--ks-X, <fallback>) N%,
// transparent) must carry the SAME byte-identical dark fallback as a plain
// var() reference — the computed color must match today's literal exactly.
//
// `--coverage` switches to the second gate (Wave A.2 step 2): count unwrapped
// color literals left in src/components + src/utils — the volume gate above
// only checks references that ALREADY went through var(), so it can't catch
// a literal nobody wrapped at all.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(rootDir, "src");
const tokensPath = path.join(rootDir, "tokens", "ks-tokens.json");
const exceptionsPath = path.join(rootDir, "docs", "THEME-EXCEPTIONS.md");
const scannedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);
const mode = process.argv.includes("--coverage") ? "coverage" : "fallbacks";

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

// Extracts `color-mix(...)` blocks with balanced-paren body parsing, same
// technique as extractVarRefs — a color-mix body legitimately nests another
// paren pair (the inner var(--ks-x, <fallback>)).
function extractColorMixBlocks(source) {
  const out = [];
  const marker = "color-mix(";
  let searchFrom = 0;
  for (;;) {
    const start = source.indexOf(marker, searchFrom);
    if (start === -1) break;
    let i = start + marker.length;
    let depth = 1;
    const bodyStart = i;
    while (i < source.length && depth > 0) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
      if (depth > 0) i++;
    }
    out.push({ index: start, body: source.slice(bodyStart, i) });
    searchFrom = i + 1;
  }
  return out;
}

// Tailwind arbitrary-value class position spells spaces as underscores
// (`bg-[color-mix(in_srgb,...)]`) — normalize before structural matching.
const colorMixPattern =
  /^in\s+srgb,\s*var\((--ks-[a-zA-Z0-9-]+)\s*,\s*((?:[^(),]|\([^()]*\))+?)\)\s*(\d+(?:\.\d+)?)%\s*,\s*transparent$/;

function checkColorMix(source, file, darkByVar, mismatches, malformed) {
  for (const block of extractColorMixBlocks(source)) {
    const normalized = block.body.replace(/_/g, " ").trim();
    const match = normalized.match(colorMixPattern);
    if (!match) {
      malformed.push({ file: path.relative(rootDir, file), line: lineOf(source, block.index), body: block.body });
      continue;
    }
    const [, varName, fallback] = match;
    const expected = darkByVar.get(varName);
    if (expected === undefined) continue;
    if (fallback.trim() !== expected) {
      mismatches.push({
        file: path.relative(rootDir, file),
        line: lineOf(source, block.index),
        varName,
        fallback: fallback.trim(),
        expected,
        form: "color-mix",
      });
    }
  }
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function runFallbackGate() {
  const { tokens } = JSON.parse(readFileSync(tokensPath, "utf8"));
  const darkByVar = new Map(tokens.map((t) => [t.cssVar, t.darkValue]));

  const mismatches = [];
  const malformed = [];
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
          form: "var",
        });
      }
    }
    checkColorMix(source, file, darkByVar, mismatches, malformed);
  }

  if (malformed.length > 0) {
    console.error(`check:tokens — ${malformed.length} malformed color-mix() block(s) (expected \`color-mix(in srgb, var(--ks-X, <fallback>) N%, transparent)\`):\n`);
    for (const m of malformed) {
      console.error(`  ${m.file}:${m.line}  color-mix(${m.body})`);
    }
    console.error("");
  }

  if (mismatches.length > 0) {
    console.error(`check:tokens — ${mismatches.length} fallback mismatch(es):\n`);
    for (const m of mismatches) {
      const wrapper = m.form === "color-mix" ? `color-mix(in srgb, var(${m.varName}, "${m.fallback}") ...)` : `var(${m.varName}, "${m.fallback}")`;
      console.error(`  ${m.file}:${m.line}  ${wrapper}`);
      console.error(`    expected dark default: "${m.expected}"\n`);
    }
    process.exit(1);
  }

  if (malformed.length > 0) process.exit(1);

  console.log("check:tokens — all var(--ks-*, <fallback>) and color-mix(...) references match their dark default.");
}

// Parses docs/THEME-EXCEPTIONS.md for backtick-quoted `path` or `path:line` /
// `path:start-end` entries — an exception either exempts a whole file (bare
// path) or specific lines within one.
function loadExceptions() {
  const fileExceptions = new Set();
  const lineExceptions = new Map(); // relative path -> Set<line>
  if (!existsSync(exceptionsPath)) return { fileExceptions, lineExceptions };

  const text = readFileSync(exceptionsPath, "utf8");
  const entryPattern = /`(src\/[^`:]+?)(?::(\d+)(?:-(\d+))?)?`/g;
  let match;
  while ((match = entryPattern.exec(text))) {
    const [, relPath, startStr, endStr] = match;
    if (!startStr) {
      fileExceptions.add(relPath);
      continue;
    }
    const start = Number(startStr);
    const end = endStr ? Number(endStr) : start;
    if (!lineExceptions.has(relPath)) lineExceptions.set(relPath, new Set());
    const set = lineExceptions.get(relPath);
    for (let n = start; n <= end; n++) set.add(n);
  }
  return { fileExceptions, lineExceptions };
}

// Tailwind palette utility classes explicitly named by the derived-color
// policy (§ Wave A.2 rule 2): zinc/gray/slate/amber/black/white.
const tailwindClassPattern =
  /\b(?:bg|text|border|from|to|via|ring|divide|outline|shadow|fill|stroke|decoration|caret|accent)-(?:zinc|gray|slate|amber|black|white)(?:-\d{2,3})?(?:\/\d{1,3})?\b/g;
const hexPattern = /#[0-9a-fA-F]{3,8}\b/g;
const rgbPattern = /rgba?\([^)]*\)/g;

function findLiteralsInLine(line) {
  const hits = [];
  for (const re of [hexPattern, rgbPattern, tailwindClassPattern]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) hits.push(m[0]);
  }
  return hits;
}

function runCoverageGate() {
  const { fileExceptions, lineExceptions } = loadExceptions();
  const coverageRoots = ["components", "utils"].map((d) => path.join(srcDir, d));

  const occurrences = [];
  for (const root of coverageRoots) {
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
      const relPath = path.relative(rootDir, file);
      if (fileExceptions.has(relPath)) continue;
      const excludedLines = lineExceptions.get(relPath);

      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      lines.forEach((line, i) => {
        const lineNo = i + 1;
        if (excludedLines?.has(lineNo)) return;
        if (line.includes("var(--ks")) return;
        for (const hit of findLiteralsInLine(line)) {
          occurrences.push({ file: relPath, line: lineNo, hit });
        }
      });
    }
  }

  if (occurrences.length === 0) {
    console.log("check:coverage — no unwrapped color literals in src/components or src/utils.");
    return;
  }

  const byFile = new Map();
  for (const occ of occurrences) {
    if (!byFile.has(occ.file)) byFile.set(occ.file, []);
    byFile.get(occ.file).push(occ);
  }
  const ranked = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);

  console.error(`check:coverage — ${occurrences.length} unwrapped color literal(s) across ${ranked.length} file(s):\n`);
  for (const [file, occs] of ranked) {
    console.error(`  ${file} — ${occs.length}`);
  }
  console.error("");
  for (const occ of occurrences) {
    console.error(`  ${occ.file}:${occ.line}  ${occ.hit}`);
  }
  process.exit(1);
}

if (mode === "coverage") {
  runCoverageGate();
} else {
  runFallbackGate();
}
