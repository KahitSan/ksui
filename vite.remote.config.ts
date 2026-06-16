import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { devSourceAttrVitePlugin } from "./dev-source-attr.js";

// Builds the plugin's UI to a single IIFE the plugin process serves at /_ui.
// solid-js and the host's shared UI kit (@kserp/host-ui) are EXTERNALIZED to
// globals the host sets before loading this bundle, so the remote renders on
// the host's single Solid runtime and reuses the exact host components. This is
// what lets a plugin UI change ship by reloading ONLY the plugin (no host
// rebuild): the host owns the generic loader (its catch-all route); this repo
// ships only the UI bundle + the manifest. The host discovers the page at
// runtime from GET /api/plugins/ui — there is no host-side file for this plugin.
//
// Tailwind: the remote ALSO compiles its own utilities (from ui/remote/**) into
// `remote.css`, served at /_ui/remote.css. The host injects that <link> when it
// loads the remote (see src/lib/remote-loader.ts). Required because the host's
// CSS is compiled from the HOST source only — any class a plugin uses that the
// host doesn't would otherwise be unstyled. `styles.css` imports only the theme
// + utilities layers (NO preflight — the host owns base/reset).
export default defineConfig({
  plugins: [devSourceAttrVitePlugin(), solid(), tailwindcss()],
  build: {
    outDir: "dist-ui",
    emptyOutDir: true,
    minify: false,
    target: "esnext",
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL("./ui/remote/index.tsx", import.meta.url)),
      formats: ["iife"],
      // Every plugin remote assigns to this ONE global; the host reads it
      // synchronously in the script onload and caches per-plugin, so the host
      // needs no per-plugin knowledge of the global name. Keep in lockstep with
      // the host's REMOTE_GLOBAL in src/lib/remote-loader.ts.
      name: "__KSERP_PLUGIN_REMOTE__",
      fileName: () => "remote.js",
      // Emit the compiled utilities as remote.css next to remote.js.
      cssFileName: "remote",
    },
    rollupOptions: {
      external: ["solid-js", "solid-js/web", "solid-js/store", "@kserp/host-ui"],
      output: {
        globals: {
          "solid-js": "__KSERP_SOLID_CORE__",
          "solid-js/web": "__KSERP_SOLID_WEB__",
          "solid-js/store": "__KSERP_SOLID_STORE__",
          "@kserp/host-ui": "__KSERP_UI__",
        },
      },
    },
  },
});
