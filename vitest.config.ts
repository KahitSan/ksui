/// <reference types="vitest" />
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

// Plugin unit + integration tests.
//
//   tests/unit/         pure logic (SQL builders, date/CASE invariants, validation,
//                        privacyClause, escapeLike) — no Postgres, no server.
//   tests/integration/  the real handler flow against a real Postgres, each test
//                        wrapped in a rolled-back transaction (withRollbackDb).
//
// Both run in a Node environment.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Load THIS plugin's OWN .env so `npm test` gets its DB connection from the
// plugin's own config — the plugin stays independent and never reaches into the
// kernel's tree. worktree-create.sh writes this .env (shared dev DB) in a
// worktree; .env.example documents the standalone contract; CI sets DB_* directly
// (dotenv never overrides set vars, and a missing .env is a no-op).
loadEnv({ path: r("./.env") });

export default defineConfig({
  resolve: {
    alias: [],
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    // Integration tests share one Postgres connection inside a rolled-back
    // transaction; running them in parallel would interleave on the same
    // client. singleFork serializes the whole suite (matches kserp's server
    // test config and the plugin pool's max=3 reality).
    pool: "forks",
    forks: { singleFork: true },
    testTimeout: 15000,
  } as any,
});
