import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

// Minimal Vite dev server for Playwright e2e tests. Serves e2e/index.html
// which imports and renders ksui components for browser-level testing.
export default defineConfig({
  plugins: [solidPlugin()],
  root: "e2e",
  server: { port: 5199 },
  preview: { port: 5199 },
});
