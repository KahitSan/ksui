#!/usr/bin/env node
// Rewrites the per-feature stamp lines in docs/BUSINESS-LOGIC.md in place —
// answers "has the cited code/tests moved since this feature was last verified"
// without trusting the doc's own prose. Run: node scripts/doc-freshness.mjs
//
// Idempotent by design: "logic changed" / "tests changed" / drift come from
// git; the "Verified" date and any "open: ..." note are read back from the
// line itself and carried forward untouched. Re-running against a tree with
// no new commits reproduces the exact same stamp lines.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DOC_PATH = path.join(REPO_ROOT, "docs", "BUSINESS-LOGIC.md");
const SEARCH_DIRS = ["server", "tests", "migrations"];
const SKIP_DIR_NAMES = new Set(["node_modules", "dist-ui", ".git"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith(".ts")) {
      out.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
    }
  }
  return out;
}

const ALL_FILES = SEARCH_DIRS.flatMap((d) => walk(path.join(REPO_ROOT, d)));
const BASENAME_INDEX = new Map();
for (const rel of ALL_FILES) {
  const base = path.basename(rel);
  if (!BASENAME_INDEX.has(base)) BASENAME_INDEX.set(base, []);
  BASENAME_INDEX.get(base).push(rel);
}

// A citation names a file two ways: a bare basename ("run-charge.ts") or a
// path with one leading subdir ("lib/transaction-subcategories.ts",
// "unit/shared.test.ts") relative to server/ or tests/. Try the more
// specific suffix match first so a subdir hint disambiguates a shared
// basename before falling back to a pure basename lookup.
function resolveFile(given) {
  const bySuffix = ALL_FILES.filter((f) => f === given || f.endsWith("/" + given));
  if (bySuffix.length === 1) return { path: bySuffix[0], ambiguous: false };
  if (bySuffix.length > 1) return { path: null, ambiguous: true };
  const base = path.basename(given);
  const candidates = BASENAME_INDEX.get(base);
  if (!candidates || candidates.length === 0) return { path: null, ambiguous: false };
  if (candidates.length === 1) return { path: candidates[0], ambiguous: false };
  return { path: null, ambiguous: true };
}

function parseRanges(rangeStr) {
  if (!/^[0-9,~-]+$/.test(rangeStr)) return null;
  const ranges = [];
  for (const seg of rangeStr.split(",")) {
    const clean = seg.replace(/~/g, "");
    if (/^\d+-\d+$/.test(clean)) {
      const [a, b] = clean.split("-").map(Number);
      ranges.push([a, b]);
    } else if (/^\d+$/.test(clean)) {
      ranges.push([Number(clean), Number(clean)]);
    } else {
      return null;
    }
  }
  return ranges;
}

// Pulls every backtick span out of one table cell and classifies it as a
// file:range citation, a bare ":range" continuation, a bare filename, or
// (silently) not a location at all (a function name, "same", "header
// comment", etc. — nothing to check).
//
// A bare ":range" always means "same file as this feature's PRIMARY route
// file" — the file named by the first citation in the feature's logic
// column, e.g. `transactions-cart-edit.ts:163-168` at the top of Feature 2.
// A later explicit `other-file.ts:range` in the same feature (a helper
// module, a migration) is a one-off for that single row: it must NOT become
// the new target for subsequent bare ":range" rows, which still mean the
// primary route file. So `state.primaryFile` is captured once per feature
// and never overwritten — only `extractCitations`'s own explicit-file
// citations use a different file for their own row.
function extractCitations(cell, isLogicColumn, state) {
  const out = [];
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(cell))) {
    const span = m[1].trim();
    const fileRange = span.match(/^([\w./-]+\.ts):(.+)$/);
    if (fileRange) {
      const [, file, rangeStr] = fileRange;
      if (isLogicColumn && !state.primaryFile) state.primaryFile = file;
      out.push({ file, ranges: parseRanges(rangeStr), raw: span });
      continue;
    }
    const bareColon = span.match(/^:(.+)$/);
    if (bareColon && isLogicColumn && state.primaryFile) {
      out.push({ file: state.primaryFile, ranges: parseRanges(bareColon[1]), raw: span });
      continue;
    }
    const fileOnly = span.match(/^([\w./-]+\.ts)$/);
    if (fileOnly) {
      if (isLogicColumn && !state.primaryFile) state.primaryFile = fileOnly[1];
      out.push({ file: fileOnly[1], ranges: null, raw: span });
    }
  }
  return out;
}

const FEATURE_HEADING_RE = /^## (\d+)\. (.+)$/;
// New format: "Verified 2026-07-19 · logic changed ... · tests ... [· ⚠ N row(s) unverified] [· open: ...]"
// Old format (back-compat, in case a stamp line reverts by hand-edit):
// "Last verified: 2026-07-19 (adversarial pass) — open gaps: Q1, Q2"
const STAMP_LINE_RE = /^(?:Verified \d{4}-\d{2}-\d{2}|Last verified:\s*\d{4}-\d{2}-\d{2})/;

function parseFeatures(lines) {
  const features = [];
  let current = null;
  lines.forEach((line, idx) => {
    const headingMatch = line.match(FEATURE_HEADING_RE);
    if (headingMatch) {
      current = {
        num: Number(headingMatch[1]),
        name: headingMatch[2].trim(),
        startIdx: idx,
        rawLines: [],
        stampLineIdx: null,
      };
      features.push(current);
      return;
    }
    if (line.startsWith("## ")) {
      current = null; // a non-numbered "## " heading closes the last feature
      return;
    }
    if (current) {
      if (current.stampLineIdx === null && STAMP_LINE_RE.test(line)) current.stampLineIdx = idx;
      current.rawLines.push(line);
    }
  });
  return features;
}

// Extracts what must survive a rewrite: the human-set "Verified" date (never
// derived from git — only a real re-verification pass may change it) and the
// "open: ..." note (which Q numbers apply — not derivable from source at all).
function parseExistingStamp(line) {
  if (!line) return { verifiedDate: null, openNote: null };
  const newFmt = line.match(/^Verified (\d{4}-\d{2}-\d{2})(.*)$/);
  if (newFmt) {
    const [, date, rest] = newFmt;
    const openMatch = rest.match(/open:\s*([^·]+)/);
    return { verifiedDate: date, openNote: openMatch ? openMatch[1].trim() : null };
  }
  const oldFmt = line.match(/^Last verified:\s*(\d{4}-\d{2}-\d{2})/);
  if (oldFmt) {
    const [, date] = oldFmt;
    // split from the date match instead of one combined regex, and trim in JS
    // rather than \s* + [^—]+ (adjacent quantifiers over overlapping char
    // classes trip sonarjs/slow-regex) — same result, no backtracking risk
    const gapsMatch = line.match(/open gaps:(.+)$/);
    return { verifiedDate: date, openNote: gapsMatch ? gapsMatch[1].trim() : null };
  }
  return { verifiedDate: null, openNote: null };
}

function isTableRow(line) {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return false;
  if (/^\|[\s:|-]+\|$/.test(t)) return false; // separator row
  return true;
}

let unparsedRows = 0;

function collectFeatureCitations(feature) {
  const state = { primaryFile: null }; // scoped to this feature only — see extractCitations
  feature.unverifiedRowCount = feature.rawLines.filter((l) => l.includes("⚠ unverified")).length;
  feature.logicCites = [];
  feature.testCites = [];

  for (const line of feature.rawLines) {
    if (!isTableRow(line)) continue;
    const cells = line
      .trim()
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    if (cells.length !== 5 || cells[0] === "Scenario") continue;
    if (cells.length !== 5) {
      unparsedRows++;
      continue;
    }
    feature.logicCites.push(...extractCitations(cells[3], true, state));
    feature.testCites.push(...extractCitations(cells[4], false, state));
  }
}

// Every citation resolves to exactly one of: a real git-tracked date, a
// missing/ambiguous file ("citation drifted"), or a range git can no longer
// find in the file ("citation drifted") — never a thrown exception.
const gitCache = new Map();

function runGit(args) {
  try {
    // local dev script only, fixed read-only args, no user input reaches PATH resolution
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function dateForRange(file, start, end) {
  const key = `${file}|${start}-${end}`;
  if (gitCache.has(key)) return gitCache.get(key);
  const out = runGit(["log", "-1", "--format=%cI", "-L", `${start},${end}:${file}`]);
  const date = out ? out.split("\n")[0].trim() || null : null;
  gitCache.set(key, date);
  return date;
}

function dateForWholeFile(file) {
  const key = `${file}|WHOLE`;
  if (gitCache.has(key)) return gitCache.get(key);
  const out = runGit(["log", "-1", "--format=%cI", "--", file]);
  gitCache.set(key, out || null);
  return out || null;
}

// Resolves one citation to { date, drifted, label } — the single source of
// truth every date/drift decision downstream reads from.
function resolveCitation(citation) {
  const { path: resolvedFile, ambiguous } = resolveFile(citation.file);
  if (!resolvedFile) {
    return { date: null, drifted: true, label: `${citation.raw}${ambiguous ? " (ambiguous basename)" : " (file not found)"}` };
  }
  if (!citation.ranges) {
    const date = dateForWholeFile(resolvedFile);
    return { date, drifted: date === null, label: date === null ? `${citation.raw} (no git history)` : null };
  }
  let latest = null;
  let anyDrift = false;
  for (const [start, end] of citation.ranges) {
    const d = dateForRange(resolvedFile, start, end);
    if (d === null) {
      anyDrift = true;
      continue;
    }
    if (!latest || d > latest) latest = d;
  }
  if (latest === null) {
    return { date: null, drifted: true, label: `${citation.raw} (range no longer resolves in ${resolvedFile})` };
  }
  return { date: latest, drifted: anyDrift, label: anyDrift ? `${citation.raw} (partial drift)` : null };
}

function summarizeCitations(citations) {
  if (citations.length === 0) return { date: null, driftLabels: [] };
  let latest = null;
  const driftLabels = [];
  for (const c of citations) {
    const r = resolveCitation(c);
    if (r.label) driftLabels.push(r.label);
    if (r.date && (!latest || r.date > latest)) latest = r.date;
  }
  return { date: latest, driftLabels };
}

function fmtDate(d) {
  return d ? d.slice(0, 10) : "—";
}

// Builds the canonical stamp line: preserved facts first (Verified date,
// open note), then everything derivable from git/the doc itself.
function buildStampLine(feature, logic, tests, preserved) {
  const verifiedDate = preserved.verifiedDate ?? "unstamped";
  const parts = [`Verified ${verifiedDate}`, `logic changed ${fmtDate(logic.date)}`];
  parts.push(feature.testCites.length === 0 ? "no tests cited" : `tests ${fmtDate(tests.date)}`);
  if (feature.unverifiedRowCount > 0) {
    const n = feature.unverifiedRowCount;
    parts.push(`⚠ ${n} row${n === 1 ? "" : "s"} unverified`);
  }
  const driftCount = logic.driftLabels.length + tests.driftLabels.length;
  if (driftCount > 0) {
    const sample = [...logic.driftLabels, ...tests.driftLabels].slice(0, 1)[0];
    const more = driftCount > 1 ? ` (+${driftCount - 1} more)` : "";
    parts.push(`⚠ citation drifted: ${sample}${more}`);
  }
  if (preserved.openNote) parts.push(`open: ${preserved.openNote}`);
  return parts.join(" · ");
}

function main() {
  const doc = readFileSync(DOC_PATH, "utf8");
  const lines = doc.split("\n"); // split/join on "\n" round-trips a trailing newline for free
  const features = parseFeatures(lines);

  let changed = 0;
  const report = [];
  for (const feature of features) {
    collectFeatureCitations(feature);
    const logic = summarizeCitations(feature.logicCites);
    const tests = summarizeCitations(feature.testCites);
    const preserved = parseExistingStamp(feature.stampLineIdx === null ? null : lines[feature.stampLineIdx]);
    const newLine = buildStampLine(feature, logic, tests, preserved);

    if (feature.stampLineIdx === null) {
      report.push(`#${feature.num} ${feature.name}: no stamp line found — skipped`);
      continue;
    }
    if (lines[feature.stampLineIdx] !== newLine) {
      lines[feature.stampLineIdx] = newLine;
      changed++;
    }
  }

  writeFileSync(DOC_PATH, lines.join("\n"), "utf8");
  console.error(`doc-freshness: ${features.length} feature(s) scanned, ${changed} stamp line(s) updated, ${unparsedRows} unparsable row(s), ${ALL_FILES.length} source file(s) indexed.`);
  for (const line of report) console.error(`  ${line}`);
}

main();
