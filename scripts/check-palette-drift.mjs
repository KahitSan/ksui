#!/usr/bin/env node
// Drift detector for the two copies that duplicate tokens/ks-tokens.json's
// literal values outside src/ (tailwind.js's addComponents/addUtilities
// object, docs/src/host-kit/brand.css) — check-token-fallbacks.mjs only
// scans src/, so a hand-edit to either file could silently reintroduce a
// literal that exact-matches a §1.2 dark value without going through
// var(--ks-*, ...). Advisory only (exit 0): a flagged literal may be an
// intentional exception (e.g. tailwind.js's Button-intent palette, which
// mirrors Button.tsx's own documented non-token tone system) or a `.light`-
// scoped literal that coincidentally matches a *dark* default by value —
// the correct token for a given literal is a role judgment call, not
// mechanical, so this reports for human review rather than gating CI.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const targets = [path.join(rootDir, "tailwind.js"), path.join(rootDir, "docs/src/host-kit/brand.css")];
const { tokens } = JSON.parse(readFileSync(path.join(rootDir, "tokens/ks-tokens.json"), "utf8"));

// Normalizes both `#rrggbb` and `rgb(r g b [/ a])` / `rgba(r,g,b,a)` forms to
// one comparable key so a hex literal and its rgb-space equivalent match.
function normalize(value) {
  const hexMatch = value.match(/^#([0-9a-fA-F]{6})$/);
  if (hexMatch) return hexMatch[1].toLowerCase();
  const rgbMatch = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)/);
  if (!rgbMatch) return null;
  const [, r, g, b, a] = rgbMatch;
  const hex = [r, g, b].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  return a !== undefined ? `${hex}@${Number(a)}` : hex;
}

const byNormalized = new Map();
for (const t of tokens) {
  const key = normalize(t.darkValue);
  if (key) byNormalized.set(key, t.cssVar);
}

let flagged = 0;
for (const file of targets) {
  const source = readFileSync(file, "utf8");
  // Strip anything already inside a var(...) call — those are already synced.
  const withoutVarCalls = source.replace(/var\([^)]*\)/g, "");
  const literalRe = /#[0-9a-fA-F]{6}\b|rgba?\([^)]*\)/g;
  let m;
  while ((m = literalRe.exec(withoutVarCalls))) {
    const key = normalize(m[0]);
    const token = key && byNormalized.get(key);
    if (token) {
      console.warn(`${path.relative(rootDir, file)}: literal ${m[0]} exact-matches ${token} but isn't var()-wrapped`);
      flagged++;
    }
  }
}

if (flagged > 0) {
  console.warn(`\n${flagged} literal(s) flagged for review — wrap in var(--ks-token, <literal>) or confirm it's an intentional exception.`);
} else {
  console.log("check:palette-drift — tailwind.js and brand.css have no un-synced exact-match literals.");
}
