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
    alias: [
      {
        find: /^@kahitsan\/ksui\/icons\/(.+)$/,
        replacement: resolve(__dirname, "../src/icons/$1"),
      },
      {
        find: "@kahitsan/ksui/icons",
        replacement: resolve(__dirname, "../src/icons/index.ts"),
      },
      {
        find: "@kahitsan/ksui",
        replacement: resolve(__dirname, "../src/index.ts"),
      },
    ],
    // One reactive runtime shared by the components. A duplicate
    // solid-js is the classic cause of dead reactivity.
    dedupe: ["solid-js", "@solidjs/web"],
  },
});
