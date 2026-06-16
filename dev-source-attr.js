// dev-source-attr.js
//
// Dev-only build tooling for the multi-repo Hilinga UI. Tags every native JSX
// element with a REPO-PREFIXED `data-source-loc="<repo>/<relpath>:<line>:<col>"`
// so you can tell which repository (the kserp host or a kplugin_*) any DOM
// element was authored in. The bare `src/...tsx:L:C` solid-devtools emits is
// ambiguous now that the running UI is assembled from 14 separate repos.
//
// Gated on KSERP_DEV_SOURCE_ATTR=1 (set by worktree-create.sh / local dev), so
// CI/prod `build:ui` and the prod `vinxi build` never emit it.
//
//   - Plugins build their UI with `vite build` (no solid-devtools in that
//     pipeline), so they add `devSourceAttrVitePlugin()` — an `enforce: "pre"`
//     transform that injects the attribute via Babel BEFORE vite-plugin-solid
//     compiles the JSX away into `_tmpl$` template strings. (Passing the Babel
//     plugin through vite-plugin-solid's own `babel` option does NOT work: it
//     runs after solid's JSX transform, so there are no JSX nodes left to tag.)
//   - The host (kserp) already gets a BARE `data-source-loc` from
//     solid-devtools on dev-serve; `devSourceAttrPrefixVitePlugin()` just
//     prefixes that existing value with the repo name.
//
// `<repo>` is the basename of the build's cwd, which is the repo directory in
// every plain checkout AND every worktree (.../<wt>/kplugin_timesheets), so
// this file is identical in all 14 repos — copy it verbatim, no per-repo edits.

/* global process */
import * as path from "node:path";

const ATTR = "data-source-loc";

export function isDevSourceAttrEnabled() {
  return process.env.KSERP_DEV_SOURCE_ATTR === "1";
}

function repoName() {
  return path.basename(process.cwd());
}

// Babel plugin: add data-source-loc to native (lowercase) JSX elements only —
// the same filter solid-devtools uses. Mirrors its column convention (+2 to
// step past the "<") so host and plugin values share one shape.
export function devSourceAttrBabelPlugin() {
  const repo = repoName();
  const root = process.cwd();
  return function ({ types: t }) {
    return {
      name: "dev-source-attr",
      visitor: {
        JSXOpeningElement(p, state) {
          const node = p.node;
          if (node.name.type !== "JSXIdentifier") return;
          if (/^[A-Z]/.test(node.name.name)) return; // native elements only
          const tagged = node.attributes.some(
            (a) => a.type === "JSXAttribute" && a.name && a.name.name === ATTR,
          );
          if (tagged || !node.loc) return;
          const file = (state.filename || "").split("?")[0];
          const rel = path.relative(root, file);
          // Only tag this repo's own source. Files outside the repo root (shared
          // node_modules deps, symlinked to the kernel) resolve to "../.." paths
          // that the repo prefix would misattribute — leave them untagged.
          if (!rel || rel.startsWith("..")) return;
          const value = `${repo}/${rel}:${node.loc.start.line}:${node.loc.start.column + 2}`;
          node.attributes.push(t.jsxAttribute(t.jsxIdentifier(ATTR), t.stringLiteral(value)));
        },
      },
    };
  };
}

// Vite plugin (plugin remotes): inject data-source-loc directly. Runs as a
// pre-pass so the Babel transform sees real JSX before vite-plugin-solid
// compiles it. Self-gated on the env flag, so it is safe to always include in
// the config — a no-op outside dev.
export function devSourceAttrVitePlugin() {
  return {
    name: "dev-source-attr-inject",
    enforce: "pre",
    async transform(code, id) {
      if (!isDevSourceAttrEnabled()) return null;
      if (!/\.[jt]sx(\?.*)?$/.test(id)) return null;
      const [{ transformAsync }, syntaxTs] = await Promise.all([
        import("@babel/core"),
        import("@babel/plugin-syntax-typescript"),
      ]);
      const res = await transformAsync(code, {
        babelrc: false,
        configFile: false,
        filename: id,
        sourceFileName: id,
        sourceMaps: true,
        plugins: [[syntaxTs.default, { isTSX: true }], devSourceAttrBabelPlugin()],
      });
      return res ? { code: res.code, map: res.map } : null;
    },
  };
}

// Vite plugin (host only): prefix the bare data-source-loc that solid-devtools
// injects on dev-serve with the repo name. Registered AFTER devtools (both
// `enforce: "pre"`, ordered by array position) so it runs on the still-JSX
// source the devtools transform produced.
export function devSourceAttrPrefixVitePlugin() {
  const prefix = repoName() + "/";
  return {
    name: "dev-source-attr-prefix",
    enforce: "pre",
    apply(_config, env) {
      return env.command === "serve" && env.mode !== "production";
    },
    transform(code, id) {
      if (!isDevSourceAttrEnabled()) return null;
      if (!/\.[jt]sx(\?.*)?$/.test(id)) return null;
      if (!code.includes(ATTR)) return null;
      const out = code.replace(/(\sdata-source-loc=")([^"]*)(")/g, (m, a, val, c) =>
        val.startsWith(prefix) ? m : `${a}${prefix}${val}${c}`,
      );
      return out === code ? null : { code: out, map: null };
    },
  };
}
