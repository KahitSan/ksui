import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { resolve } from "node:path";

// Base path for GitHub Pages. The repo is served at /ksui/ on Pages; locally
// VITE_BASE is unset so it falls back to "/".
const base = process.env.VITE_BASE ?? "/ksui/";

export default defineConfig({
  base,
  plugins: [solid()],
  resolve: {
    alias: {
      // Every component does `import { Button } from "@kserp/host-ui"`. The
      // alias is keyed on the bare specifier so all of them resolve to the
      // mock with zero component edits.
      "@kserp/host-ui": resolve(__dirname, "src/mocks/host-ui.tsx"),
      // Import the real components from source (not dist) so vite-plugin-solid
      // compiles their JSX with the rest of the app.
      "@kahitsan/ksui": resolve(__dirname, "../src/index.ts"),
    },
    // One reactive runtime shared by the components and the mock. A duplicate
    // solid-js is the classic cause of dead reactivity.
    dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
  },
});
