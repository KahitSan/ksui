#!/usr/bin/env node
// Derives per-feature staleness of docs/BUSINESS-LOGIC.md from git history —
// answers "has the cited code/tests moved since this feature was last verified"
// without trusting the doc's own prose. Run: node scripts/doc-freshness.mjs
//
// Deterministic by design: every date it prints comes from the doc's own
// "Last verified" stamp or from git commit metadata — never from the wall
// clock — so two runs against the same tree always print the same table.

import { readFileSync, existsSync, readdirSync } from "node:fs";
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
const STAMP_RE = /Last verified:\s*(\d{4}-\d{2}-\d{2})/;

function parseFeatures(doc) {
  const lines = doc.split("\n");
  const features = [];
  let current = null;
  for (const line of lines) {
    const headingMatch = line.match(FEATURE_HEADING_RE);
    if (headingMatch) {
      current = {
        num: Number(headingMatch[1]),
        name: headingMatch[2].trim(),
        rawLines: [],
        verifiedDate: null,
      };
      features.push(current);
      continue;
    }
    if (line.startsWith("## ")) {
      current = null; // a non-numbered "## " heading closes the last feature
      continue;
    }
    if (current) current.rawLines.push(line);
  }
  return features;
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
  const stampMatch = feature.rawLines.join("\n").match(STAMP_RE);
  feature.verifiedDate = stampMatch ? stampMatch[1] : null;
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

// Resolves one citation to { date, drifted, resolvedFile } — the single
// source of truth every date/drift decision downstream reads from.
function resolveCitation(citation) {
  const { path: resolvedFile, ambiguous } = resolveFile(citation.file);
  if (!resolvedFile) {
    return { date: null, drifted: true, label: `citation drifted: ${citation.raw}${ambiguous ? " (ambiguous basename)" : " (file not found)"}` };
  }
  if (!citation.ranges) {
    const date = dateForWholeFile(resolvedFile);
    return {
      date,
      drifted: date === null,
      label: date === null ? `citation drifted: ${citation.raw} (no git history)` : null,
      resolvedFile,
    };
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
    return { date: null, drifted: true, label: `citation drifted: ${citation.raw} (range no longer resolves in ${resolvedFile})` };
  }
  return { date: latest, drifted: anyDrift, label: anyDrift ? `citation partially drifted: ${citation.raw}` : null, resolvedFile };
}

function summarizeCitations(citations) {
  if (citations.length === 0) return { date: null, drifted: [], files: [] };
  let latest = null;
  const drifted = [];
  const files = new Set();
  for (const c of citations) {
    const r = resolveCitation(c);
    if (r.resolvedFile) files.add(r.resolvedFile);
    if (r.label) drifted.push(r.label);
    if (r.date && (!latest || r.date > latest)) latest = r.date;
  }
  return { date: latest, drifted, files: [...files] };
}

function commitsSince(files, sinceDate) {
  if (!files.length || !sinceDate) return null;
  const out = runGit(["log", `--since=${sinceDate}`, "--format=%H", "--", ...files]);
  if (out === null) return null;
  return out ? out.split("\n").filter(Boolean).length : 0;
}

function fmtDate(d) {
  return d ? d.slice(0, 10) : "—";
}

function main() {
  const doc = readFileSync(DOC_PATH, "utf8");
  const features = parseFeatures(doc);

  const rows = [];
  for (const feature of features) {
    collectFeatureCitations(feature);
    const logic = summarizeCitations(feature.logicCites);
    const tests = summarizeCitations(feature.testCites);
    const allFiles = [...new Set([...logic.files, ...tests.files])];
    const commits = commitsSince(allFiles, feature.verifiedDate);

    const notes = [];
    if (logic.drifted.length || tests.drifted.length) {
      notes.push(...logic.drifted, ...tests.drifted);
    }
    if (feature.unverifiedRowCount > 0) {
      notes.push(`${feature.unverifiedRowCount} row(s) marked ⚠ unverified`);
    }
    if (!feature.verifiedDate) notes.push("no verification stamp found");

    rows.push({
      num: feature.num,
      name: feature.name,
      logicChanged: fmtDate(logic.date),
      testsChanged: feature.testCites.length === 0 ? "no test citations" : fmtDate(tests.date),
      verified: feature.verifiedDate ?? "unstamped",
      commitsSince: commits === null ? "n/a" : String(commits),
      notes: notes.length ? notes.join("; ") : "—",
    });
  }

  const header = "| # | Feature | Logic last changed | Tests last changed | Last verified | Commits touching cited files since verified | Notes |";
  const sep = "|---|---|---|---|---|---|---|";
  const lines = [header, sep];
  for (const r of rows) {
    lines.push(
      `| ${r.num} | ${r.name} | ${r.logicChanged} | ${r.testsChanged} | ${r.verified} | ${r.commitsSince} | ${r.notes} |`,
    );
  }

  console.log(lines.join("\n"));
  console.error(`\n(${features.length} features, ${unparsedRows} unparsable row(s), ${ALL_FILES.length} source files indexed)`);
}

main();
