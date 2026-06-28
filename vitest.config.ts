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
// Both run in a Node environment. Vite does NOT read tsconfig `paths`, so the
// kernel-source + plugin-server-utils aliases the plugin's tsconfig declares for
// runtime (tsx) are mirrored here by hand — same posture as kserp's own
// vitest.server.config.ts. The plugin resolves `@ks-erp/kernel*` to the sibling
// kernel SOURCE (../kserp/kernel-*/index.ts), not a built dist.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Load THIS plugin's OWN .env so `npm test` gets its DB connection from the
// plugin's own config — the plugin stays independent and never reaches into the
// kernel's tree. worktree-create.sh writes this .env (shared dev DB) in a
// worktree; .env.example documents the standalone contract; CI sets DB_* directly
// (dotenv never overrides set vars, and a missing .env is a no-op).
loadEnv({ path: r("./.env") });

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@ks-erp\/kernel-base$/, replacement: r("../kserp/kernel-base/index.ts") },
      { find: /^@ks-erp\/kernel-composite$/, replacement: r("../kserp/kernel-composite/index.ts") },
      { find: /^@ks-erp\/kernel-orchestrator$/, replacement: r("../kserp/kernel-orchestrator/index.ts") },
      { find: /^@ks-erp\/kernel-gateway$/, replacement: r("../kserp/kernel-gateway/index.ts") },
      { find: /^@ks-erp\/kernel-theme$/, replacement: r("../kserp/kernel-theme/index.ts") },
      { find: /^@ks-erp\/kernel$/, replacement: r("../kserp/kernel/index.ts") },
      { find: /^@ks-erp\/kernel\/(.*)$/, replacement: r("../kserp/kernel/$1.ts") },
      {
        find: /^@kahitsan\/plugin-server-utils\/test$/,
        replacement: r("../kserp/packages/plugin-server-utils/src/test/index.ts"),
      },
      {
        find: /^@kahitsan\/plugin-server-utils$/,
        replacement: r("../kserp/packages/plugin-server-utils/src/index.ts"),
      },
    ],
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
