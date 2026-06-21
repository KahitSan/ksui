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
import { makeDatabaseService, runMigrations } from "@kahitsan/plugin-sdk";
import type { PluginManifest } from "@kahitsan/plugin-sdk";
import { mountPluginServices } from "@kahitsan/plugin-sdk";
import { applyTenantContext, parseIdentity, requireAuth, requireWorkspace, requirePermission, withTenantContext } from "@kahitsan/plugin-sdk";
import { insertTransactionRow, insertVisibilityShares } from "./lib/create-transaction.js";
import { buildRouter } from "./routes.js";
import { buildLineItemsRouter } from "./routes-line-items.js";

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
  // Cap the pool: N plugins x M autoscale instances must not exhaust Postgres.
  // node-postgres defaults to 10 per pool; 11 pools x 10 = 110 > 97 usable
  // backends. Fail fast on saturation instead of hanging. Tunable via env;
  // the default of 3 is plenty for one plugin behind the kernel proxy.
  max: parseInt(process.env.KSERP_PLUGIN_POOL_MAX || "3", 10),
  connectionTimeoutMillis: parseInt(process.env.KSERP_PLUGIN_POOL_CONNECT_TIMEOUT_MS || "5000", 10),
  idleTimeoutMillis: 30000,
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
  // parsed so each handler is workspace-scoped via req.workspaceId. These are the
  // methods the monolith's transactionsExtensionPoint exposed; packages reads
  // getPackageCapacityUsage to enforce per-package capacity / daily / monthly
  // limits at the cart.
  mountPluginServices(
    app,
    {
      // findById({ id }) → a workspace-scoped transaction row, or null.
      findById: async (args, { req }) => {
        const id = (args as { id?: unknown })?.id;
        if (req.workspaceId == null || id == null) return null;
        const r = await db.query(
          `SELECT id, workspace_id, created_at, updated_at, amount, status, category
             FROM accounts.transactions WHERE id = $1 AND workspace_id = $2`,
          [id, req.workspaceId],
        );
        return r.rows[0] ?? null;
      },

      // getAccountBalances({ accountIds }) →
      //   { [accountId]: { balance } }
      // Per-account computed balance, workspace-scoped, mirroring the monolith's
      // financial-accounts ACCOUNT_BALANCE_SQL definition — but computed HERE,
      // inside the plugin that owns accounts.transactions / transaction_payments,
      // because the financial-accounts plugin's DB role can't read these tables.
      //
      // The balance for an account is the sum of two mutually-exclusive halves
      // (so a sale is never counted twice):
      //   (a) Sales WITH recorded payment legs: each leg whose
      //       financial_account_id matches credits its amount. Source of truth
      //       for split payments (a sale split 60/40 across two accounts credits
      //       each its share).
      //   (b) Everything else routed by the legacy source_account_id /
      //       destination_account_id columns: money in via destination minus
      //       money out via source. Excludes sales that already have a leg
      //       (the NOT EXISTS guard) so (a) and (b) don't double-count.
      // Voided transactions are excluded on both sides. Returned as a plain
      // object (JSON over the RPC can't carry a Map).
      getAccountBalances: async (args, { req }) => {
        const a = (args ?? {}) as { accountIds?: unknown };
        const wsId = req.workspaceId;
        const accountIds = Array.isArray(a.accountIds)
          ? a.accountIds
              .map((v) => (typeof v === "number" ? v : parseInt(String(v), 10)))
              .filter((n) => Number.isInteger(n))
          : [];
        const out: Record<number, { balance: number }> = {};
        if (wsId == null || accountIds.length === 0) return out;
        for (const id of accountIds) out[id] = { balance: 0 };

        const r = await db.query<{ account_id: number; balance: string }>(
          `WITH ids AS (SELECT UNNEST($2::int[]) AS account_id),
                leg_sums AS (
                  SELECT tp.financial_account_id AS account_id,
                         SUM(tp.amount) AS amt
                    FROM accounts.transaction_payments tp
                    JOIN accounts.transactions t ON t.id = tp.transaction_id
                   WHERE tp.workspace_id = $1
                     AND t.workspace_id = $1
                     AND tp.financial_account_id = ANY($2::int[])
                     AND t.status <> 'voided'
                     AND t.category = 'sale'
                   GROUP BY tp.financial_account_id
                ),
                legacy_sums AS (
                  SELECT i.account_id,
                         SUM(CASE WHEN t.destination_account_id = i.account_id THEN t.amount ELSE 0 END)
                       - SUM(CASE WHEN t.source_account_id = i.account_id THEN t.amount ELSE 0 END) AS amt
                    FROM ids i
                    JOIN accounts.transactions t
                      ON (t.source_account_id = i.account_id OR t.destination_account_id = i.account_id)
                   WHERE t.workspace_id = $1
                     AND t.status <> 'voided'
                     AND (
                       t.category <> 'sale'
                       OR NOT EXISTS (
                         SELECT 1 FROM accounts.transaction_payments tp2
                          WHERE tp2.transaction_id = t.id
                       )
                     )
                   GROUP BY i.account_id
                )
           SELECT i.account_id,
                  (COALESCE(ls.amt, 0) + COALESCE(lg.amt, 0))::text AS balance
             FROM ids i
             LEFT JOIN leg_sums ls ON ls.account_id = i.account_id
             LEFT JOIN legacy_sums lg ON lg.account_id = i.account_id`,
          [wsId, accountIds],
        );
        for (const row of r.rows) {
          out[row.account_id] = { balance: parseFloat(row.balance) || 0 };
        }
        return out;
      },

      // getPackageCapacityUsage({ packageIds, at? }) →
      //   { [packageId]: { concurrent, daily, monthly } }
      // Computed from THIS plugin's transaction_line_items, workspace-scoped. Voided
      // lines and lines under a voided transaction are excluded. `concurrent`
      // in NOW mode follows the Counter board rule (status='active' and start
      // in the past); the forward-looking `at` path uses the strict time
      // window. daily/monthly anchor on Asia/Manila wall-clock. Mirrors the
      // monolith's extension-point impl, returned as a plain object (JSON over
      // the RPC can't carry a Map).
      getPackageCapacityUsage: async (args, { req }) => {
        const a = (args ?? {}) as { packageIds?: unknown; at?: unknown };
        const wsId = req.workspaceId;
        const packageIds = Array.isArray(a.packageIds)
          ? a.packageIds.map((v) => (typeof v === "number" ? v : parseInt(String(v), 10))).filter((n) => Number.isInteger(n))
          : [];
        const out: Record<number, { concurrent: number; daily: number; monthly: number; incoming: number }> = {};
        if (wsId == null || packageIds.length === 0) return out;
        for (const id of packageIds) out[id] = { concurrent: 0, daily: 0, monthly: 0, incoming: 0 };

        const at = typeof a.at === "string" ? a.at : null;
        const useNow = at === null;
        const concurrentClause = useNow
          ? `(li.status IN ('active', 'expired') AND (li.started_at IS NULL OR li.started_at <= NOW()) AND (li.ends_at IS NULL OR li.ends_at > NOW()))`
          : `((li.started_at IS NULL OR li.started_at <= $3::timestamptz) AND (li.ends_at IS NULL OR li.ends_at > $3::timestamptz))`;
        const incomingClause = useNow
          ? `li.status = 'active' AND li.started_at IS NOT NULL AND li.started_at > NOW()`
          : `FALSE`;
        const dailyClause = useNow
          ? `t.transaction_date = (NOW() AT TIME ZONE 'Asia/Manila')::date`
          : `t.transaction_date = ($3::timestamptz AT TIME ZONE 'Asia/Manila')::date`;
        const monthlyClause = useNow
          ? `date_trunc('month', t.transaction_date) = date_trunc('month', (NOW() AT TIME ZONE 'Asia/Manila')::date)`
          : `date_trunc('month', t.transaction_date) = date_trunc('month', ($3::timestamptz AT TIME ZONE 'Asia/Manila')::date)`;

        const params: unknown[] = [wsId, packageIds];
        if (!useNow) params.push(at);

        const r = await db.query<{
          package_id: number;
          concurrent: string;
          daily: string;
          monthly: string;
          incoming: string;
        }>(
          `SELECT li.package_id,
                  COUNT(*) FILTER (WHERE li.status <> 'voided' AND ${concurrentClause})::text AS concurrent,
                  COUNT(*) FILTER (WHERE li.status <> 'voided' AND ${dailyClause})::text AS daily,
                  COUNT(*) FILTER (WHERE li.status <> 'voided' AND ${monthlyClause})::text AS monthly,
                  COUNT(*) FILTER (WHERE li.status <> 'voided' AND ${incomingClause})::text AS incoming
             FROM accounts.transaction_line_items li
             JOIN accounts.transactions t
               ON t.id = li.transaction_id AND t.workspace_id = li.workspace_id
            WHERE li.workspace_id = $1
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
            incoming: parseInt(row.incoming, 10) || 0,
          };
        }
        return out;
      },

      // createSalaryTransaction({ amount, payee_id, source_account_id, notes,
      //   transaction_date }) → { id, amount, transaction_date }
      // Producer side of the payroll flow: the timesheets plugin calls this to
      // record a private "Salary - Direct" expense when it marks shifts paid,
      // so timesheets never writes the accounts.* schema it can't see. The shape
      // is fixed to the salary use case — category/subcategory/description and
      // the director+accountant visibility grants are baked in, NOT
      // caller-controlled, so the cross-plugin surface stays minimal. Salary is
      // not VATable, so tax is zeroed (non_vat). Workspace-scoped via req.workspaceId;
      // created_by is the calling user relayed in the signed identity header.
      createSalaryTransaction: async (args, { req }) => {
        const a = (args ?? {}) as {
          amount?: unknown;
          payee_id?: unknown;
          source_account_id?: unknown;
          notes?: unknown;
          transaction_date?: unknown;
        };
        const wsId = req.workspaceId;
        const userId = req.user?.id;
        if (wsId == null || !userId) throw new Error("Workspace and user context required");

        const amount = typeof a.amount === "number" ? a.amount : parseFloat(String(a.amount));
        if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be greater than 0");

        const payeeId =
          a.payee_id == null ? null : Number.isFinite(Number(a.payee_id)) ? parseInt(String(a.payee_id), 10) : null;
        const sourceAccountId =
          a.source_account_id == null
            ? null
            : Number.isFinite(Number(a.source_account_id))
              ? parseInt(String(a.source_account_id), 10)
              : null;
        const transactionDate =
          typeof a.transaction_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.transaction_date)
            ? a.transaction_date
            : null;
        if (!transactionDate) throw new Error("transaction_date must be YYYY-MM-DD");
        const notes = typeof a.notes === "string" ? a.notes : null;

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await applyTenantContext(client);
          const txn = await insertTransactionRow(client, {
            workspaceId: wsId,
            category: "expense",
            subcategory: "Salary - Direct",
            sourceAccountId,
            destinationAccountId: null,
            amount,
            description: "Salary",
            notes,
            transactionDate,
            isPrivate: true,
            isBackdated: false,
            backdateReason: null,
            createdBy: userId,
            referenceNumber: null,
            taxType: "non_vat",
            taxRate: 0,
            taxAmount: 0,
            subtotal: amount,
            payableKind: null,
            dueDate: null,
            chequeNumber: null,
            pdcStatus: null,
            hasEwt: false,
            ewtRate: null,
            ewtAmount: null,
            clientId: null,
            payeeId,
          });
          await insertVisibilityShares(client, txn.id as number, {
            isPrivate: true,
            sharedWithRoles: ["director", "accountant"],
          });
          await client.query("COMMIT");
          return { id: txn.id, amount, transaction_date: transactionDate };
        } catch (e) {
          await client.query("ROLLBACK").catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      },
    },
    { parseIdentity },
  );

  // Feature routes. parseIdentity reads the kernel-forwarded principal onto the
  // request; the per-route gates enforce it. The kernel proxies basePath/* here
  // with the prefix stripped, so the router mounts at "/".
  app.use(parseIdentity);
  // RLS activation (plugin-SDK Step 2): scope every db.query under app_authenticated so the workspace-isolation policies engage behind the explicit workspace_id filter.
  app.use(withTenantContext);
  // Sibling basePath: the kernel proxies /api/transaction-line-items/* here
  // (declared in plugin.manifest.json additionalBasePaths) WITHOUT stripping
  // the prefix, so this router's routes are written at the full prefix and
  // mount on the app root. Registered before the primary "/" router so the
  // line-items paths match first.
  app.use(buildLineItemsRouter({ db, requireAuth, requireWorkspace, requirePermission }));
  app.use("/", buildRouter({ db, requireAuth, requireWorkspace, requirePermission }));

  app.listen(PORT, process.env.KSERP_PLUGIN_BIND || "127.0.0.1", () => {
    console.log(
      `[transactions] standalone server on http://${process.env.KSERP_PLUGIN_BIND || '127.0.0.1'}:${PORT} (schemas: ${schemas.join(",") || "public"})`,
    );
  });
}

start().catch((err) => {
  console.error("[transactions] failed to start:", err);
  process.exit(1);
});
