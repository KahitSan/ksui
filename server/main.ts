// Standalone plugin server (process-isolation model) — bootstrapped by the
// shared `createPluginServer` helper.
//
// This plugin runs in its OWN process: its own pg pool scoped to the `accounts`
// schema, its own migrations on boot, the kernel reverse-proxying
// /api/transactions/* (and the sibling /api/transaction-line-items/*) here with
// the authenticated principal forwarded in a signed header. Deploying it
// reloads only this process, never the kernel.
//
// Everything mechanical — manifest/port/schemas, the capped pool, migrations,
// the health probe, the /_ui bundle, parseIdentity + the RLS withTenantContext
// wall, and listen — lives in `createPluginServer`. This file declares only
// what's unique to transactions: the cross-plugin RPC services it EXPOSES
// (findById, getAccountBalances, getPackageCapacityUsage,
// hasClientAvailedPackage, createSalaryTransaction)
// and its two feature routers (line-items first, then the primary router).

import "dotenv/config";
import { createPluginServer, applyTenantContext, buildResourceServices } from "@kahitsan/plugin-sdk";
import { flows } from "./flows.js";
import { flows as accountFlows } from "./flows-accounts.js";
import {
  insertTransactionRow,
  insertVisibilityShares,
} from "./lib/create-transaction.js";
import { isBackdated } from "./lib/backdate.js";
import {
  hasClientAvailedPackage as hasClientAvailedPackageQuery,
  parseAvailedPackageChecks,
} from "./lib/has-client-availed-package.js";
import { computeAccountBalances } from "./lib/account-balances.js";
import { buildRouter } from "./routes.js";
import { buildLineItemsRouter } from "./routes-line-items.js";
import { buildPayeesRouter } from "./routes-payees.js";
import { buildPrefixedRouter as buildAccountsRouter, accountsResource } from "./routes-accounts.js";
import { boardVersion, bumpBoardVersion } from "./lib/board-events.js";

/** Local type for the SDK's req object in service handlers — mirrors
 *  ForwardedIdentity fields used by the handler code. */
interface ServiceReq {
  workspaceId?: number;
  user?: { id: string; role?: string };
}

type CapacityUsage = { concurrent: number; daily: number; monthly: number; incoming: number };

// Capacity counts are re-aggregated on every CapacityStrip poll and cart
// interaction even when nothing changed. Entries are valid only while the
// workspace's board version holds (any write bumps it — see lib/board-events)
// AND within a short TTL: the `concurrent` bucket also decays by wall clock
// (sessions expire with no write), so time-based staleness must stay bounded.
const CAPACITY_TTL_MS = 5_000;
const capacityCache = new Map<
  string,
  { v: number; at: number; data: Record<number, CapacityUsage> }
>();

createPluginServer({
  importMetaUrl: import.meta.url,
  flows: [...flows, ...accountFlows],
  // A1: opt into the kernel object store for account logos (ctx.assets).
  assets: true,
  // ── Producer side: transactions.service ──────────────────────────────────
  // Secret-gated POST /_internal/services/:method, identity parsed so each
  // handler is workspace-scoped via req.workspaceId. These are the methods the
  // monolith's transactionsExtensionPoint exposed; packages reads
  // getPackageCapacityUsage to enforce per-package capacity / daily / monthly
  // limits at the cart.
  services: ({ db, pool }) => ({
    // Folded-in from the standalone financial-accounts plugin: resource-backed
    // findByIds so peers (subscriptions, packages) can resolve account display
    // names without importing this plugin's tables directly.
    ...buildResourceServices(accountsResource, { db }),
    // findById({ id }) → a workspace-scoped transaction row, or null.
    findById: async (args, { req }) => { const svcReq = req as unknown as ServiceReq;
      const id = (args as { id?: unknown })?.id;
      if (svcReq.workspaceId == null || id == null) return null;
      const r = await db.query(
        `SELECT id, workspace_id, created_at, updated_at, amount, status, category
           FROM accounts.transactions WHERE id = $1 AND workspace_id = $2`,
        [id, svcReq.workspaceId]
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
    getAccountBalances: async (args, { req }) => { const svcReq = req as unknown as ServiceReq;
      const a = (args ?? {}) as { accountIds?: unknown };
      const wsId = svcReq.workspaceId;
      const accountIds = Array.isArray(a.accountIds)
        ? a.accountIds
            .map((v) => (typeof v === "number" ? v : parseInt(String(v), 10)))
            .filter((n) => Number.isInteger(n))
        : [];
      if (wsId == null) return {} as Record<number, { balance: number }>;
      return computeAccountBalances(db, wsId, accountIds);
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
    getPackageCapacityUsage: async (args, { req }) => { const svcReq = req as unknown as ServiceReq;
      const a = (args ?? {}) as { packageIds?: unknown; at?: unknown };
      const wsId = svcReq.workspaceId;
      const packageIds = Array.isArray(a.packageIds)
        ? a.packageIds
            .map((v) => (typeof v === "number" ? v : parseInt(String(v), 10)))
            .filter((n) => Number.isInteger(n))
        : [];
      const out: Record<number, CapacityUsage> = {};
      if (wsId == null || packageIds.length === 0) return out;
      for (const id of packageIds)
        out[id] = { concurrent: 0, daily: 0, monthly: 0, incoming: 0 };

      const at = typeof a.at === "string" ? a.at : null;
      const cacheKey = `${wsId}|${at ?? "now"}|${[...packageIds].sort((x, y) => x - y).join(",")}`;
      const cached = capacityCache.get(cacheKey);
      if (
        cached &&
        cached.v === boardVersion(wsId) &&
        Date.now() - cached.at < CAPACITY_TTL_MS
      ) {
        return cached.data;
      }
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
        params
      );
      for (const row of r.rows) {
        out[row.package_id] = {
          concurrent: parseInt(row.concurrent, 10) || 0,
          daily: parseInt(row.daily, 10) || 0,
          monthly: parseInt(row.monthly, 10) || 0,
          incoming: parseInt(row.incoming, 10) || 0,
        };
      }
      // Bounded: entries expire in 5s, so the map only grows with DISTINCT
      // (workspace, ids) shapes queried inside one window — clear as a backstop.
      if (capacityCache.size > 500) capacityCache.clear();
      capacityCache.set(cacheKey, { v: boardVersion(wsId), at: Date.now(), data: out });
      return out;
    },

    /**
     * hasClientAvailedPackage({ clientId, checks }) → { [checkKey]: boolean }
     *
     * Batched eligibility check for packages' `client_availed_package_before`
     * condition: for each check, did this client have an active/completed line
     * item against one of `packageIds` (a lineage's era ids, resolved by the
     * CALLER since packages owns lineage_slug, not this plugin) dated before
     * `beforeDate`? Packages can't read accounts.* directly (its DB role can't
     * see it, per the tiered isolation model), so it batches every conditional
     * row in the active list into one round trip instead of one call per row.
     */
    hasClientAvailedPackage: async (args, { req }) => { const svcReq = req as unknown as ServiceReq;
      const wsId = svcReq.workspaceId;
      const a = (args ?? {}) as { clientId?: unknown; checks?: unknown };
      const clientId =
        typeof a.clientId === "number" ? a.clientId : parseInt(String(a.clientId), 10);
      if (wsId == null || !Number.isInteger(clientId)) return {};
      const checks = parseAvailedPackageChecks(a.checks);
      if (checks.length === 0) return {};
      return hasClientAvailedPackageQuery(db, wsId, clientId, checks);
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
    createSalaryTransaction: async (args, { req }) => { const svcReq = req as unknown as ServiceReq;
      const a = (args ?? {}) as {
        amount?: unknown;
        payee_id?: unknown;
        source_account_id?: unknown;
        notes?: unknown;
        transaction_date?: unknown;
        backdate_reason?: unknown;
      };
      const wsId = svcReq.workspaceId;
      const userId = svcReq.user?.id;
      if (wsId == null || !userId)
        throw new Error("Workspace and user context required");

      const amount =
        typeof a.amount === "number" ? a.amount : parseFloat(String(a.amount));
      if (!Number.isFinite(amount) || amount <= 0)
        throw new Error("amount must be greater than 0");

      const payeeId =
        a.payee_id == null
          ? null
          : Number.isFinite(Number(a.payee_id))
          ? parseInt(String(a.payee_id), 10)
          : null;
      const sourceAccountId =
        a.source_account_id == null
          ? null
          : Number.isFinite(Number(a.source_account_id))
          ? parseInt(String(a.source_account_id), 10)
          : null;
      const transactionDate =
        typeof a.transaction_date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(a.transaction_date)
          ? a.transaction_date
          : null;
      if (!transactionDate)
        throw new Error("transaction_date must be YYYY-MM-DD");
      const notes = typeof a.notes === "string" ? a.notes : null;
      const backdateReason =
        typeof a.backdate_reason === "string" && a.backdate_reason.trim()
          ? a.backdate_reason.trim() : null;
      const backdated = isBackdated(transactionDate);

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
          isBackdated: backdated,
          backdateReason,
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
        // RPC writes bypass the router middleware — bump explicitly.
        bumpBoardVersion(wsId);
        return { id: txn.id, amount, transaction_date: transactionDate };
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  }),
  // Full-prefix routers FIRST: the kernel proxies /api/transaction-line-items/*
  // and /api/payees/* here (manifest additionalBasePaths) WITHOUT stripping the
  // prefix, so their routes are written at the full prefix and must match before
  // the primary "/" router's "/:id" capture. payees was folded in from the
  // retired standalone plugin — same process, own `/api/payees` root.
  routers: [
    ({ db, requireAuth, requireWorkspace, requirePermission }) =>
      buildLineItemsRouter({
        db,
        requireAuth,
        requireWorkspace,
        requirePermission,
      }),
    ({ db, requireAuth, requireWorkspace, requirePermission }) =>
      buildPayeesRouter({ db, requireAuth, requireWorkspace, requirePermission }),
    // Folded-in accounts router — serves `/api/financial-accounts/*` for the
    // renamed `finance` plugin. The URL namespace stays the same for API
    // stability across external consumers of the standalone-era endpoints.
    ({ db, requireAuth, requireWorkspace, requirePermission, assets }) =>
      buildAccountsRouter({
        db,
        requireAuth,
        requireWorkspace,
        requirePermission,
        assets,
      }),
    ({ db, requireAuth, requireWorkspace, requirePermission }) =>
      buildRouter({ db, requireAuth, requireWorkspace, requirePermission }),
  ],
}).catch((err) => {
  console.error("[transactions] failed to start:", err);
  process.exit(1);
});
