// Standalone plugin server (process-isolation model).
//
// This plugin runs in its OWN process — its own Express app, its own pg pool
// scoped to the `accounts` schema, and it runs its OWN migrations on boot. The
// kernel never imports this code; it reverse-proxies /api/transactions/* here
// (basePath stripped) and forwards the authenticated principal in a signed
// header that `parseIdentity` verifies. Deploying this plugin restarts only
// this process, never the kernel.
//
// It also EXPOSES a cross-plugin service (transactions.service) via
// mountPluginServices, and CONSUMES packages/vouchers/clients over the kernel
// RPC (lib/peers.ts) — the two halves of the fork's cross-process
// interconnection model.
//
// Config arrives via env: KSERP_PLUGIN_PORT (or manifest.port), DB_* (same
// database as the kernel), KSERP_INTERNAL_SECRET (shared with the kernel for
// the signed header + internal RPC), KSERP_KERNEL_URL (where outbound RPC goes,
// set by the kernel when it spawns the plugin), KSERP_PLUGIN_SCHEMAS (optional
// override of manifest schemas).

import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import pg from "pg";
import { makeDatabaseService } from "@ks-erp/kernel/services/database";
import { runMigrations } from "@ks-erp/kernel/migrations";
import type { PluginManifest } from "@ks-erp/kernel/types";
import { mountPluginServices } from "@ks-erp/kernel/service-rpc";
import { parseIdentity, requireAuth, requireOrg, requirePermission } from "./identity.js";
import { buildRouter } from "./routes.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(here, "..", "plugin.manifest.json"), "utf8"),
) as PluginManifest;

const PORT = parseInt(process.env.KSERP_PLUGIN_PORT || String(manifest.port ?? 4020), 10);
const schemas = (process.env.KSERP_PLUGIN_SCHEMAS || (manifest.schemas ?? []).join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "ks_erp",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
});
pool.on("error", (err) =>
  console.error("[transactions] pg idle client error (swallowed, pool reconnects):", err),
);
const db = makeDatabaseService(pool, schemas);

async function start(): Promise<void> {
  // The plugin owns its schema's migrations and runs them on its own boot —
  // idempotent, advisory-locked, tracked under this plugin's name. On a DB
  // that already has the accounts.* tables (the pre-plugin monolith), every
  // statement no-ops.
  await runMigrations(pool, join(here, "..", "migrations"), { plugin: manifest.name });

  const app = express();
  app.use(express.json());

  // Readiness probe for the kernel's dev spawn wait-loop. No auth.
  app.get("/_internal/health", (_req, res) => {
    res.json({ status: "ok", plugin: manifest.name, version: manifest.version });
  });

  // Serve the plugin's runtime UI bundle (built by `npm run build:ui` into
  // dist-ui). The host loads /api/transactions/_ui/remote.js at runtime.
  app.use("/_ui", express.static(join(here, "..", "dist-ui")));

  // ── Producer side: transactions.service ──────────────────────────────────
  // Mounts POST /_internal/services/:method, internal-secret gated, identity
  // parsed so each handler is org-scoped via req.organizationId. These are the
  // methods the monolith's transactionsExtensionPoint exposed; packages reads
  // getPackageCapacityUsage to enforce per-package capacity / daily / monthly
  // limits at the cart.
  mountPluginServices(
    app,
    {
      // findById({ id }) → an org-scoped transaction row, or null.
      findById: async (args, { req }) => {
        const id = (args as { id?: unknown })?.id;
        if (req.organizationId == null || id == null) return null;
        const r = await db.query(
          `SELECT id, organization_id, created_at, updated_at, amount, status, category
             FROM accounts.transactions WHERE id = $1 AND organization_id = $2`,
          [id, req.organizationId],
        );
        return r.rows[0] ?? null;
      },

      // getPackageCapacityUsage({ packageIds, at? }) →
      //   { [packageId]: { concurrent, daily, monthly } }
      // Computed from THIS plugin's transaction_line_items, org-scoped. Voided
      // lines and lines under a voided transaction are excluded. `concurrent`
      // in NOW mode follows the Counter board rule (status='active' and start
      // in the past); the forward-looking `at` path uses the strict time
      // window. daily/monthly anchor on Asia/Manila wall-clock. Mirrors the
      // monolith's extension-point impl, returned as a plain object (JSON over
      // the RPC can't carry a Map).
      getPackageCapacityUsage: async (args, { req }) => {
        const a = (args ?? {}) as { packageIds?: unknown; at?: unknown };
        const orgId = req.organizationId;
        const packageIds = Array.isArray(a.packageIds)
          ? a.packageIds.map((v) => (typeof v === "number" ? v : parseInt(String(v), 10))).filter((n) => Number.isInteger(n))
          : [];
        const out: Record<number, { concurrent: number; daily: number; monthly: number }> = {};
        if (orgId == null || packageIds.length === 0) return out;
        for (const id of packageIds) out[id] = { concurrent: 0, daily: 0, monthly: 0 };

        const at = typeof a.at === "string" ? a.at : null;
        const useNow = at === null;
        const concurrentClause = useNow
          ? `(li.status = 'active' AND (li.started_at IS NULL OR li.started_at <= NOW()))`
          : `((li.started_at IS NULL OR li.started_at <= $3::timestamptz) AND (li.ends_at IS NULL OR li.ends_at > $3::timestamptz))`;
        const dailyClause = useNow
          ? `t.transaction_date = (NOW() AT TIME ZONE 'Asia/Manila')::date`
          : `t.transaction_date = ($3::timestamptz AT TIME ZONE 'Asia/Manila')::date`;
        const monthlyClause = useNow
          ? `date_trunc('month', t.transaction_date) = date_trunc('month', (NOW() AT TIME ZONE 'Asia/Manila')::date)`
          : `date_trunc('month', t.transaction_date) = date_trunc('month', ($3::timestamptz AT TIME ZONE 'Asia/Manila')::date)`;

        const params: unknown[] = [orgId, packageIds];
        if (!useNow) params.push(at);

        const r = await db.query<{
          package_id: number;
          concurrent: string;
          daily: string;
          monthly: string;
        }>(
          `SELECT li.package_id,
                  COUNT(*) FILTER (WHERE li.status <> 'voided' AND ${concurrentClause})::text AS concurrent,
                  COUNT(*) FILTER (WHERE li.status <> 'voided' AND ${dailyClause})::text AS daily,
                  COUNT(*) FILTER (WHERE li.status <> 'voided' AND ${monthlyClause})::text AS monthly
             FROM accounts.transaction_line_items li
             JOIN accounts.transactions t
               ON t.id = li.transaction_id AND t.organization_id = li.organization_id
            WHERE li.organization_id = $1
              AND li.package_id = ANY($2::int[])
              AND t.status <> 'voided'
            GROUP BY li.package_id`,
          params,
        );
        for (const row of r.rows) {
          out[row.package_id] = {
            concurrent: parseInt(row.concurrent, 10) || 0,
            daily: parseInt(row.daily, 10) || 0,
            monthly: parseInt(row.monthly, 10) || 0,
          };
        }
        return out;
      },
    },
    { parseIdentity },
  );

  // Feature routes. parseIdentity reads the kernel-forwarded principal onto the
  // request; the per-route gates enforce it. The kernel proxies basePath/* here
  // with the prefix stripped, so the router mounts at "/".
  app.use(parseIdentity);
  app.use("/", buildRouter({ db, requireAuth, requireOrg, requirePermission }));

  app.listen(PORT, "127.0.0.1", () => {
    console.log(
      `[transactions] standalone server on http://127.0.0.1:${PORT} (schemas: ${schemas.join(",") || "public"})`,
    );
  });
}

start().catch((err) => {
  console.error("[transactions] failed to start:", err);
  process.exit(1);
});
