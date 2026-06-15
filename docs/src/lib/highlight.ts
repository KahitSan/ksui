// Build time syntax highlighting via Shiki's fine grained core API. Using the
// core highlighter with explicit imports keeps the bundle to just the two
// grammars we need (tsx, bash) plus one theme, instead of statically pulling in
// every Shiki language.

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import tsx from "shiki/langs/tsx.mjs";
import bash from "shiki/langs/bash.mjs";
import githubDark from "shiki/themes/github-dark.mjs";

let hlPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!hlPromise) {
    hlPromise = createHighlighterCore({
      themes: [githubDark],
      langs: [tsx, bash],
      engine: createOnigurumaEngine(import("shiki/wasm")),
    });
  }
  return hlPromise;
}

// Strip the docs only import boilerplate: everything up to and including a
// `// example-start` marker line is removed so the displayed source is just the
// component usage, not the harness imports.
export function stripExampleBoilerplate(code: string): string {
  const marker = "// example-start";
  const idx = code.indexOf(marker);
  if (idx === -1) return code.trim();
  const after = code.slice(idx + marker.length);
  return after.replace(/^\r?\n/, "").trimEnd();
}

export async function highlight(code: string, lang: "tsx" | "bash" = "tsx"): Promise<string> {
  const hl = await getHighlighter();
  return hl.codeToHtml(code, { lang, theme: "github-dark" });
}
