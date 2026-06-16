import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { resolve } from "node:path";

// The docs are served at the root of ksui.kahitsan.com, so the base path is "/".
// VITE_BASE can override it (for example to host under a sub-path).
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [solid()],
  resolve: {
    alias: {
      // Import the real components from source (not dist) so vite-plugin-solid
      // compiles their JSX with the rest of the app.
      "@kahitsan/ksui": resolve(__dirname, "../src/index.ts"),
    },
    // One reactive runtime shared by the components. A duplicate
    // solid-js is the classic cause of dead reactivity.
    dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
  },
});
