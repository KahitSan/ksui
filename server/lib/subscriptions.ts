// Subscriptions: a read-VIEW over accounts.transaction_line_items + a renew
// that writes a fresh sale, recovered from the monolith
// (server/routes/subscriptions.ts) into the plugin architecture.
//
// WHY this lives in the transactions plugin (not a standalone one): a
// subscription is "every time-bound line item a client bought against a package
// lineage", which is accounts.* data this plugin owns. The monolith computed it
// with cross-schema JOINs (packages for lineage_slug, clients for names). The
// fork forbids those JOINs, so the grouping that was a SQL CTE is done HERE in
// TypeScript: read the qualifying line items from accounts.*, resolve each
// package's lineage_slug over the packages RPC, group by (client, lineage),
// then enrich client + variant names over RPC. The renew stays here too because
// it INSERTs accounts.transactions + accounts.transaction_line_items.

import type { Context as HonoContext } from "hono";
import { applyTenantContext } from "@kahitsan/plugin-sdk";
import type { PluginDb } from "@kahitsan/plugin-sdk";
import { identityHeaderOf } from "@kahitsan/plugin-sdk";
import { findPackagesByIds, findClientsByIds, findVariantsByIds } from "./peers.js";

const DAY_MS = 86_400_000;

type StatusBucket = "active" | "expiring-soon" | "expired";
const VALID_BUCKETS: readonly StatusBucket[] = ["active", "expiring-soon", "expired"];
const SORTABLE = new Set([
  "latest_ends_at",
  "started_at",
  "client_name",
  "renewal_count",
  "total_revenue",
]);

// The privacy fragment is identical to routes.ts's privacyClause; passed in so
// the two share one source of truth.
type PrivacyClause = (c: HonoContext, params: unknown[], startIdx: number) => string | null;

interface LineRow {
  id: number;
  client_id: number;
  package_id: number;
  package_variant_id: number | null;
  quantity: string;
  unit_price: string;
  started_at: string;
  ends_at: string;
}

export interface SubscriptionRow {
  client_id: number;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  lineage_slug: string;
  started_at: string;
  latest_ends_at: string;
  renewal_count: number;
  total_revenue: string;
  latest_line_item_id: number;
  status_bucket: StatusBucket;
  days_until_expiry: number;
  latest_variant_id: number | null;
  latest_variant_name: string | null;
  latest_unit_price: string;
  latest_package_name: string | null;
  current_package_id: number | null;
  current_package_name: string | null;
}

function bucketFor(latestEndsMs: number, nowMs: number): StatusBucket {
  if (latestEndsMs > nowMs + 14 * DAY_MS) return "active";
  if (latestEndsMs > nowMs - 30 * DAY_MS) return "expiring-soon";
  return "expired";
}

/** GET /subscriptions — grouped list with bucket/search filters, sort, paging. */
export async function listSubscriptions(
  db: PluginDb,
  c: HonoContext,
  privacyClause: PrivacyClause,
): Promise<{ data: SubscriptionRow[]; total: number; page: number; limit: number }> {
  const search = (c.req.query("search"))?.trim().toLowerCase();
  const lineageSlug = (c.req.query("lineage_slug"))?.trim();
  const bucketRaw = (c.req.query("status_bucket"))?.trim();
  const sortByRaw = (c.req.query("sortBy")) ?? "latest_ends_at";
  const sortBy = SORTABLE.has(sortByRaw) ? sortByRaw : "latest_ends_at";
  const sortDir = (c.req.query("sortDir"))?.toUpperCase() === "ASC" ? 1 : -1;
  const page = Math.max(1, parseInt(c.req.query("page") ?? "") || 1);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "") || 25, 200);

  let buckets: Set<StatusBucket> | null;
  if (bucketRaw === "all") {
    buckets = null;
  } else if (bucketRaw) {
    const parsed = bucketRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is StatusBucket => (VALID_BUCKETS as readonly string[]).includes(s));
    buckets = new Set(parsed.length ? parsed : (["active", "expiring-soon"] as StatusBucket[]));
  } else {
    buckets = new Set(["active", "expiring-soon"] as StatusBucket[]);
  }

  // Qualifying line items from accounts.* (privacy enforced here so a private
  // renewal can't leak through the aggregate). No packages/clients JOIN — those
  // schemas are off this plugin's search_path; we resolve them over RPC below.
  const params: unknown[] = [c.get("workspaceId")];
  const conditions = [
    "li.workspace_id = $1",
    "li.client_id IS NOT NULL",
    "li.duration_unit IN ('day', 'month')",
    "li.ends_at IS NOT NULL",
    "li.status <> 'voided'",
    "t.status <> 'voided'",
  ];
  const priv = privacyClause(c, params, params.length + 1);
  if (priv) conditions.push(priv);

  const result = await db.query<LineRow>(
    `SELECT li.id, li.client_id, li.package_id, li.package_variant_id,
            li.quantity, li.unit_price,
            li.started_at::text AS started_at, li.ends_at::text AS ends_at
       FROM accounts.transaction_line_items li
       JOIN accounts.transactions t ON t.id = li.transaction_id
      WHERE ${conditions.join(" AND ")}`,
    params,
  );
  const lines = result.rows;

  // Resolve lineage_slug + names over RPC. A package the line item references
  // is always returned (it exists); a lineage's CURRENT era (effective_to NULL)
  // is whichever of its referenced packages carries that flag — may be absent
  // when the current era hasn't been sold yet, in which case the UI falls back
  // to the latest package name and resolves the renewal variants from
  // /api/packages by lineage_slug.
  const idh = identityHeaderOf(c.req.raw as unknown as Parameters<typeof identityHeaderOf>[0]);
  const pkgIds = [...new Set(lines.map((l) => l.package_id))];
  const pkgs = pkgIds.length > 0 ? ((await findPackagesByIds(pkgIds, idh)) ?? []) : [];
  const pkgById = new Map(pkgs.map((p) => [p.id, p]));

  // Current-era package per lineage (effective_to IS NULL among referenced pkgs).
  const currentByLineage = new Map<string, { id: number; name: string }>();
  for (const p of pkgs) {
    if (p.lineage_slug && (p.effective_to == null || p.effective_to === "")) {
      currentByLineage.set(p.lineage_slug, { id: p.id, name: p.name });
    }
  }

  // Group by (client_id, lineage_slug). A line whose package has no resolvable
  // lineage (packages plugin down, or a stray id) falls back to "pkg:<id>" so it
  // still appears as its own subscription rather than vanishing.
  interface Group {
    client_id: number;
    lineage_slug: string;
    first_started: number;
    latest_ends: number;
    renewal_count: number;
    total_revenue: number;
    latest: LineRow;
  }
  const groups = new Map<string, Group>();
  for (const l of lines) {
    const lineage = pkgById.get(l.package_id)?.lineage_slug ?? `pkg:${l.package_id}`;
    if (lineageSlug && lineage !== lineageSlug) continue;
    const key = `${l.client_id}::${lineage}`;
    const startedMs = new Date(l.started_at).getTime();
    const endsMs = new Date(l.ends_at).getTime();
    const revenue = parseFloat(l.unit_price) * parseFloat(l.quantity);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        client_id: l.client_id,
        lineage_slug: lineage,
        first_started: startedMs,
        latest_ends: endsMs,
        renewal_count: 1,
        total_revenue: revenue,
        latest: l,
      });
    } else {
      g.first_started = Math.min(g.first_started, startedMs);
      g.renewal_count += 1;
      g.total_revenue += revenue;
      // Latest line item: greatest ends_at, tie-break greatest id (mirrors the
      // monolith's ORDER BY ends_at DESC, id DESC LIMIT 1).
      if (endsMs > g.latest_ends || (endsMs === g.latest_ends && l.id > g.latest.id)) {
        g.latest_ends = endsMs;
        g.latest = l;
      }
    }
  }

  // Enrich client + latest-variant names over RPC.
  const clientIds = [...new Set([...groups.values()].map((g) => g.client_id))];
  const clients = clientIds.length > 0 ? ((await findClientsByIds(clientIds, idh)) ?? []) : [];
  const clientById = new Map(clients.map((c) => [c.id, c]));

  const variantIds = [
    ...new Set(
      [...groups.values()]
        .map((g) => g.latest.package_variant_id)
        .filter((v): v is number => v != null),
    ),
  ];
  const variants = variantIds.length > 0 ? ((await findVariantsByIds(variantIds, idh)) ?? []) : [];
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const nowMs = Date.now();
  let rows: SubscriptionRow[] = [...groups.values()].map((g) => {
    const c = clientById.get(g.client_id);
    const v = g.latest.package_variant_id != null ? variantById.get(g.latest.package_variant_id) : undefined;
    const cur = currentByLineage.get(g.lineage_slug);
    const latestPkg = pkgById.get(g.latest.package_id);
    return {
      client_id: g.client_id,
      client_name: c?.name ?? null,
      client_email: c?.email ?? null,
      client_phone: c?.phone ?? null,
      lineage_slug: g.lineage_slug,
      started_at: new Date(g.first_started).toISOString(),
      latest_ends_at: new Date(g.latest_ends).toISOString(),
      renewal_count: g.renewal_count,
      total_revenue: g.total_revenue.toFixed(2),
      latest_line_item_id: g.latest.id,
      status_bucket: bucketFor(g.latest_ends, nowMs),
      days_until_expiry: Math.trunc((g.latest_ends - nowMs) / DAY_MS),
      latest_variant_id: g.latest.package_variant_id,
      latest_variant_name: v?.name ?? null,
      latest_unit_price: parseFloat(g.latest.unit_price).toFixed(2),
      latest_package_name: latestPkg?.name ?? null,
      current_package_id: cur?.id ?? null,
      current_package_name: cur?.name ?? null,
    };
  });

  // Post-aggregation filters: bucket + search (client name/email/phone).
  if (buckets) rows = rows.filter((r) => buckets!.has(r.status_bucket));
  if (search) {
    rows = rows.filter(
      (r) =>
        (r.client_name ?? "").toLowerCase().includes(search) ||
        (r.client_email ?? "").toLowerCase().includes(search) ||
        (r.client_phone ?? "").toLowerCase().includes(search),
    );
  }

  // Sort, then page in app code (the data set is bounded — subscriptions per workspace).
  rows.sort((a, b) => {
    let cmp: number;
    switch (sortBy) {
      case "client_name":
        cmp = (a.client_name ?? "").localeCompare(b.client_name ?? "");
        break;
      case "started_at":
        cmp = new Date(a.started_at).getTime() - new Date(b.started_at).getTime();
        break;
      case "renewal_count":
        cmp = a.renewal_count - b.renewal_count;
        break;
      case "total_revenue":
        cmp = parseFloat(a.total_revenue) - parseFloat(b.total_revenue);
        break;
      default:
        cmp = new Date(a.latest_ends_at).getTime() - new Date(b.latest_ends_at).getTime();
    }
    if (cmp === 0) cmp = a.client_id - b.client_id;
    return cmp * sortDir;
  });

  const total = rows.length;
  const start = (page - 1) * limit;
  return { data: rows.slice(start, start + limit), total, page, limit };
}

/** Typed error so routes.ts can map to the right HTTP status. */
export class RenewError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** POST /subscriptions/:line_item_id/renew — fresh sale chaining from prior expiry. */
export async function renewSubscription(
  db: PluginDb,
  c: HonoContext,
  sourceId: number,
  body: { package_variant_id?: number; quantity?: number; destination_account_id?: number },
): Promise<{ transaction: unknown; line_item: unknown }> {
  const { package_variant_id, destination_account_id } = body;
  const qty = typeof body.quantity === "number" && body.quantity > 0 ? body.quantity : 1;
  if (typeof package_variant_id !== "number" || package_variant_id <= 0) {
    throw new RenewError(400, "package_variant_id is required");
  }
  if (typeof destination_account_id !== "number" || destination_account_id <= 0) {
    throw new RenewError(400, "destination_account_id is required");
  }

  const idh = identityHeaderOf(c.req.raw as unknown as Parameters<typeof identityHeaderOf>[0]);

  // Variant must be a workspace-owned day/month variant (RPC; clients/packages live
  // in their own schemas). Cross-package renewals are allowed (era upgrades).
  const variants = (await findVariantsByIds([package_variant_id], idh)) ?? [];
  const variant = variants.find((v) => v.id === package_variant_id);
  if (!variant) throw new RenewError(400, "package_variant_id must belong to this workspace");
  const durationUnit = variant.duration_unit;
  if (durationUnit !== "day" && durationUnit !== "month") {
    throw new RenewError(400, "renewal variant must have day or month duration");
  }
  const durationValue = parseFloat(String(variant.duration_value ?? 0));
  const unitPrice = parseFloat(String(variant.price ?? 0));

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await applyTenantContext(client);

    // Source must itself be a subscription line item in this workspace (so a direct
    // API call can't renew an hourly rental or a scrubbed row).
    const srcRes = await client.query(
      `SELECT li.id, li.client_id, li.package_id
         FROM accounts.transaction_line_items li
        WHERE li.id = $1 AND li.workspace_id = $2
          AND li.duration_unit IN ('day', 'month')
          AND li.status <> 'voided'`,
      [sourceId, c.get("workspaceId")],
    );
    if (srcRes.rows.length === 0 || srcRes.rows[0].client_id == null) {
      await client.query("ROLLBACK");
      throw new RenewError(404, "Source line item not found in this workspace");
    }
    const src = srcRes.rows[0] as { client_id: number; package_id: number };

    // Resolve the source's lineage so the chain spans every era of the plan.
    const srcPkgs = (await findPackagesByIds([src.package_id], idh)) ?? [];
    const lineageSlug = srcPkgs.find((p) => p.id === src.package_id)?.lineage_slug ?? null;

    // Serialize concurrent renews for the same (workspace, client, lineage) chain so
    // two parallel POSTs can't both read the same MAX(ends_at) and overlap.
    // Released automatically at COMMIT. See the monolith note for why this is an
    // advisory lock rather than a row-level FOR UPDATE.
    const chainKey = lineageSlug ?? `pkg:${src.package_id}`;
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `renew:${c.get("workspaceId")}:${src.client_id}:${chainKey}`,
    ]);

    // Latest ends_at across the (client, lineage) chain. lineage isn't in
    // accounts.*, so gather the client's subscription line items, map their
    // packages to lineages over RPC, and take MAX(ends_at) within the source's
    // lineage. Holding the per-chain lock makes this read the source of truth.
    const chainRes = await client.query(
      `SELECT li.id, li.package_id, li.ends_at
         FROM accounts.transaction_line_items li
         JOIN accounts.transactions t ON t.id = li.transaction_id
        WHERE li.workspace_id = $1 AND li.client_id = $2
          AND li.duration_unit IN ('day', 'month')
          AND li.status <> 'voided' AND t.status <> 'voided'`,
      [c.get("workspaceId"), src.client_id],
    );
    const chainPkgIds = [...new Set(chainRes.rows.map((r) => r.package_id as number))];
    const chainPkgs = chainPkgIds.length > 0 ? ((await findPackagesByIds(chainPkgIds, idh)) ?? []) : [];
    const lineageByPkg = new Map(chainPkgs.map((p) => [p.id, p.lineage_slug ?? `pkg:${p.id}`]));
    const sourceLineage = lineageSlug ?? `pkg:${src.package_id}`;
    let latestEndsAt: Date | null = null;
    for (const r of chainRes.rows as { package_id: number; ends_at: string | null }[]) {
      const lin = lineageByPkg.get(r.package_id) ?? `pkg:${r.package_id}`;
      if (lin !== sourceLineage || r.ends_at == null) continue;
      const d = new Date(r.ends_at);
      if (latestEndsAt == null || d.getTime() > latestEndsAt.getTime()) latestEndsAt = d;
    }

    // Destination account must belong to this workspace (accounts.* — owned).
    const acctRes = await client.query(
      `SELECT id FROM accounts.financial_accounts WHERE id = $1 AND workspace_id = $2`,
      [destination_account_id, c.get("workspaceId")],
    );
    if (acctRes.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new RenewError(400, "destination_account_id must belong to this workspace");
    }

    const totalUnits = durationValue * qty;
    const total = unitPrice * qty;
    // Chain from prior expiry only when it's still in the future; a long-lapsed
    // customer renews from today, not retroactively.
    const chainFromPrior = latestEndsAt != null && latestEndsAt.getTime() > Date.now();
    const startedAtExpr = "COALESCE($8::timestamptz, NOW())";
    const intervalExpr =
      durationUnit === "day" ? "make_interval(days => $9)" : "make_interval(months => $9)";

    const txResult = await client.query(
      `INSERT INTO accounts.transactions
         (workspace_id, category, subcategory, destination_account_id, amount, description,
          transaction_date, status, created_by,
          tax_type, tax_rate, tax_amount, subtotal,
          client_id, discount_amount)
       VALUES ($1, 'sale', 'Sales - services', $2, $3, $4,
               CURRENT_DATE, 'completed', $5,
               'vat_inclusive', 0, 0, $3,
               $6, 0)
       RETURNING id, workspace_id, category, amount, description, transaction_date, status, client_id, destination_account_id`,
      [c.get("workspaceId"), destination_account_id, total, `Renewal × ${variant.name}`, c.get("user")!.id, src.client_id],
    );
    const txn = txResult.rows[0];

    const liResult = await client.query(
      `INSERT INTO accounts.transaction_line_items
         (transaction_id, workspace_id, package_id, package_variant_id,
          description, quantity, unit_price, duration_value, duration_unit,
          started_at, ends_at, status, client_id)
       VALUES ($1, $2, $3, $4,
               $5, $6, $7, $10, $11,
               ${startedAtExpr}, ${startedAtExpr} + ${intervalExpr},
               'active', $12)
       RETURNING id, transaction_id, package_id, package_variant_id, description,
                 quantity, unit_price, started_at, ends_at, status, client_id`,
      [
        txn.id,
        c.get("workspaceId"),
        variant.package_id,
        package_variant_id,
        variant.name,
        qty,
        unitPrice,
        chainFromPrior ? latestEndsAt : null,
        totalUnits,
        durationValue,
        durationUnit,
        src.client_id,
      ],
    );

    await client.query("COMMIT");
    return { transaction: txn, line_item: liResult.rows[0] };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
