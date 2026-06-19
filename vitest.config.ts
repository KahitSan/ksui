/// <reference types="vitest" />
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

// ksui component tests run in jsdom (DOM simulation, no real browser) with
// vite-plugin-solid compiling .tsx → SolidJS. Setup strips injected <style>
// tags + resets portal DOM between tests so each component renders clean.
export default defineConfig({
  plugins: [solidPlugin()],
  server: { fs: { strict: false } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
