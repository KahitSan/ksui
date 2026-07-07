// Financial accounts plugin — server routes (process-isolation model), now
// SPEC-DRIVEN.
//
// The standard write surface (create / update / soft-delete / restore) is
// generated at runtime from the `accountsResource` declaration below by the
// kernel resource runtime (`defineResource` → `buildResourceRouter`); every
// read/write runs through the F3 data surface, which injects
// `AND workspace_id = <ctx>` from the ambient tenant context, with the RLS
// policy (`financial_accounts_org_isolation`) as the second wall behind it.
//
// Four routes stay HAND-AUTHORED (the sanctioned escape hatch — genuinely
// non-CRUD or side-effectful), mounted BEFORE the generated router so the list
// `/` and the static `/:id/logo` paths win:
//   - GET /     — the list. Enriches each row with a `balance` field fetched
//                 from the transactions plugin via cross-plugin RPC
//                 (`fetchBalances`/`tryCallPlugin`). The generated list can't
//                 enrich, so `list` is OMITTED in the spec and this stays raw.
//   - GET /:id  — single account, ALSO balance-enriched. The spec sets
//                 `get: false` so no generated `GET /:id` shadows it.
//   - POST/DELETE /:id/logo — S3 multipart upload/removal. Byte-for-byte the
//                 monolith's; no generated counterpart.
//
// Per-action `financial_accounts.*` RBAC is enforced in-process by the generated
// router (the `permissions` block); the proxy forwards the principal but does
// NOT gate per-action. The escape-hatch routes gate themselves explicitly.
//
// On-disk migrations stay authoritative for the table + the case-insensitive
// unique index (`uq_financial_accounts_org_name` on (workspace_id, LOWER(name)))
// + the RLS/GRANT triad; the schema types below are NOMINAL (router column-set
// only, never regenerated into DDL). The 409 on a case-folded duplicate name is
// reproduced via `create.conflictMessage`, NOT a generated unique index.

import { Hono, type Context, type MiddlewareHandler } from "hono";
import crypto from "node:crypto";
import type { PluginDb, DefinedResource, PluginAssets } from "@kahitsan/plugin-sdk";
import {
  Types,
  defineResource,
  buildResourceRouter,
  makeDataSurface,
} from "@kahitsan/plugin-sdk";
import {
  s3Enabled,
  s3PublicUrl,
  s3PutObject,
  s3DeleteObject,
  s3KeyFromUrl,
  s3GetObject,
} from "@kahitsan/plugin-sdk";
import { computeAccountBalances } from "./lib/account-balances.js";
import { ctxGet } from "./types.js";

// Per-account balance map — same shape the standalone financial-accounts plugin
// used to fetch from `transactions` via cross-plugin RPC before the fold-in.
type AccountBalanceMap = Record<number, { balance: number }>;

// In-plugin balance computation now that financial_accounts + transactions live
// in the same process — no more self-RPC round-trip through the kernel. The
// workspace_id is asserted by the tenant context the router already sets, so
// only the id list is passed here.
async function fetchBalances(
  db: PluginDb,
  workspaceId: number,
  accountIds: number[]
): Promise<AccountBalanceMap> {
  if (accountIds.length === 0) return {};
  return computeAccountBalances(db, workspaceId, accountIds);
}

const SORTABLE_COLUMNS = ["name", "type", "is_active", "created_at"];

// The five account types the monolith accepts. The migration's CHECK widens to
// include all five so create/update validation and the DB agree.
const VALID_TYPES = [
  "bank",
  "e_wallet",
  "cash",
  "external",
  "capital",
] as const;

// Icon slugs the client may pick. Each maps to a lucide icon at the UI layer.
// Exported so the unit suite's regression guard documents the exact contract.
export const VALID_ICONS = [
  "banknote",
  "landmark",
  "building",
  "credit-card",
  "smartphone",
  "wallet",
  "coins",
  "piggy-bank",
  "dollar-sign",
  "receipt",
] as const;

// Mirrors the DB-level CHECK: a leading '#' then six hex chars. The same shape
// an <input type="color"> picker produces.
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Explicit column list — the data surface bans `SELECT *`/`RETURNING *`, and the
// response shape stays byte-identical to the monolith's (all eleven table
// columns; logo_path was dropped, s3_link is the sole logo reference). The
// generated router's responseColumns and the escape-hatch list/get/logo SELECTs
// all project exactly these.
const ACCOUNT_COLS = [
  "id",
  "workspace_id",
  "name",
  "type",
  "description",
  "is_active",
  "created_at",
  "updated_at",
  "icon",
  "color",
  "s3_link",
] as const;

// A type alias (not an interface) so it satisfies pg's `QueryResultRow` index
// constraint when passed as the surface's row generic.
type AccountRow = {
  id: number;
  workspace_id: number;
  name: string;
  type: string;
  description: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  icon: string | null;
  color: string | null;
  s3_link: string | null;
};

// ── validators (shared between the spec's create record-validator and the unit
// suite's regression guards) ─────────────────────────────────────────────────

// The exact 400 message for an out-of-allowlist (or absent) `type`. Absent and
// invalid both fail — the monolith required type on create — and the wording
// matches the hand-written route + the generated `oneOf` message used on update.
function typeError(type: unknown): string | null {
  if (!type || !(VALID_TYPES as readonly string[]).includes(type as string)) {
    return `type must be one of: ${VALID_TYPES.join(", ")}`;
  }
  return null;
}

// The 400 message for an out-of-allowlist icon (null/absent is acceptable — the
// column is nullable). Shared so the create + update paths can't drift.
function iconError(icon: unknown): string | null {
  if (
    icon != null &&
    !(VALID_ICONS as readonly string[]).includes(String(icon))
  ) {
    return `icon must be null or one of: ${VALID_ICONS.join(", ")}`;
  }
  return null;
}

// The 400 message for a malformed hex color (null/absent is acceptable).
function colorError(color: unknown): string | null {
  if (color != null && !HEX_COLOR_RE.test(String(color))) {
    return "color must be a 7-character hex string like #ab12cd";
  }
  return null;
}

/**
 * The declarative financial-accounts resource. Reproduces the hand-written
 * plugin's write surface (create / update / soft-delete / restore) byte-for-
 * behavior. The two balance-enriched reads (GET / and GET /:id) and the two logo
 * routes stay hand-authored escape-hatches (see the module header).
 *
 * - `list` is OMITTED and `get: false` — both reads enrich each row with a peer
 *   plugin's `balance` (cross-plugin RPC), which the generated read can't do, so
 *   they are hand-authored below and the runtime mounts no generated counterpart.
 * - CREATE: the type/icon/color allowlists are a record-level `validate` (not the
 *   per-field `oneOf`, which the generated create path never applies — it runs
 *   only on update) so an ABSENT type still produces the monolith's
 *   "type must be one of" message in the exact create ordering
 *   (name-required → type → icon → color). `name` is required + trimmed.
 *   `description`/`icon`/`color` collapse a blank/absent value to NULL.
 * - UPDATE: per-field `oneOf` reproduces the type allowlist (the generated update
 *   message matches the monolith's verbatim); a record-level `validate` covers
 *   the icon/color allowlists in the monolith's order (type → icon → color); an
 *   empty `name` is rejected via the field's `notEmpty`. The generated 404 / "No
 *   fields to update" / non-numeric-id-400 all match the hand-written route.
 * - case-insensitive dup name → 409 via `conflictMessage` (a function so the
 *   create path names the offending account). The unique index lives in the
 *   migration; the spec declares NO index (it would only duplicate it).
 * - findByIds RPC is a plain id→columns batch read, so it is declared as a spec
 *   `service` and wired via `buildResourceServices` in main.ts (columns match the
 *   monolith's RPC 1:1 — transactions/counter consume them).
 * - RBAC: `restore` is overridden to `financial_accounts.edit` — the manifest
 *   declares no `.restore` permission and the monolith gated restore on edit.
 */
export const accountsResource: DefinedResource = defineResource({
  name: "financial_account",
  table: "financial_accounts",
  schema: {
    name: Types.TEXT({ notNull: true }),
    type: Types.TEXT({ notNull: true }),
    description: Types.TEXT(),
    is_active: Types.BOOLEAN({ notNull: true, default: true }),
    created_at: Types.TIMESTAMP({ notNull: true, default: "now" }),
    updated_at: Types.TIMESTAMP({ notNull: true, default: "now" }),
    icon: Types.TEXT(),
    color: Types.TEXT(),
    s3_link: Types.TEXT(),
  },
  softDelete: { column: "is_active", restore: true },
  touchOnWrite: "updated_at",
  // `list` is OMITTED (selective mounting): GET / is hand-authored below
  // (balance-enriched), so the runtime mounts no generated list to shadow it.
  // `get: false` for the same reason on GET /:id.
  get: false,
  create: {
    fields: {
      name: { required: true, trim: true },
      type: {},
      description: { coerce: (v) => v || null },
      icon: { coerce: (v) => (v ?? null) as unknown },
      color: { coerce: (v) => (v ?? null) as unknown },
    },
    // Record-level (sees ALL coerced values incl. an absent type) so the exact
    // monolith ordering + messages hold: name-required is the per-field built-in
    // (fires first), then type → icon → color here.
    validate: (v) =>
      typeError(v.type) ?? iconError(v.icon) ?? colorError(v.color),
    // A case-folded duplicate name is a REJECT (409), not an idempotent dedupe.
    // The function form names the offending account, matching the monolith's
    // create 409 wording; the update-collide path reuses the same body (its
    // `set.name` is present whenever a name was supplied).
    conflictMessage: (values) =>
      values.name
        ? `An account named "${String(
            values.name
          ).trim()}" already exists in this workspace (names are compared case-insensitively).`
        : "Another account with that name already exists in this workspace (names are compared case-insensitively).",
  },
  update: {
    method: "PUT",
    fields: {
      name: { notEmpty: true, trim: true },
      // The generated `oneOf` message ("type must be one of: ...") matches the
      // monolith's update message verbatim; oneOf is applied on the update path.
      type: { oneOf: VALID_TYPES },
      description: { coerce: (v) => v || null },
      icon: { coerce: (v) => (v ?? null) as unknown },
      color: { coerce: (v) => (v ?? null) as unknown },
    },
    // icon/color allowlists (type is handled by the field `oneOf` above). Order
    // matches the monolith: type (field oneOf, runs first) → icon → color.
    validate: (set) => iconError(set.icon) ?? colorError(set.color),
  },
  responseColumns: ACCOUNT_COLS,
  // Cross-plugin RPC: transactions/counter resolve account display rows by id.
  // A plain id→columns batch read (no shaping), so the generated service reader
  // expresses it exactly — columns match the monolith's RPC 1:1.
  services: {
    findByIds: { columns: ["id", "name", "type", "icon", "color", "s3_link"] },
  },
  // restore overridden to `.edit` — the manifest declares no `.restore` code and
  // the monolith gated restore on edit. view/create/edit/delete use defaults.
  permissions: {
    key: "financial_accounts",
    restore: "financial_accounts.edit",
  },
});

// ── Logo upload config ────────────────────────────────────────────────────
// The ImageCropper crops client-side and encodes to webp via canvas.toBlob
// (Safari can silently fall back to png — accepted here, still stored under a
// .webp object key; browsers sniff the real type when rendering). Bytes are
// buffered in memory and PUT to object storage — nothing is written to disk.
const LOGO_MIMES = ["image/webp", "image/png", "image/jpeg"];
const MAX_LOGO_SIZE = 5 * 1024 * 1024; // 5MB (a 512px crop is far smaller)

/** Everything the router needs from its host process — its scoped db and the
 * auth gates. The plugin's own identity middleware supplies these. */
export type RouterDeps = {
  db: PluginDb;
  requireAuth: MiddlewareHandler;
  requireWorkspace: MiddlewareHandler;
  requirePermission: (...codes: string[]) => MiddlewareHandler;
  // A1: present when the plugin opted into `assets: true` (ctx.assets). Absent in
  // a standalone/legacy deploy, so the logo paths degrade to s3_link only.
  assets?: PluginAssets;
};

// A1 ledger helpers — kept out of the route handlers so the dual-store paths
// don't blow past the cognitive-complexity budget, and so the "best-effort,
// never fail the request" contract lives in one place.

// Register logo bytes in the kernel asset ledger; returns the new asset id, or
// null when assets aren't wired or the ledger call fails (degrade to s3_link).
async function uploadLogoToLedger(
  deps: RouterDeps,
  buffer: Buffer,
  mimeType: string
): Promise<number | null> {
  if (!deps.assets) return null;
  try {
    const asset = await deps.assets.upload(buffer, {
      fileName: "logo.webp",
      mimeType,
    });
    return asset.id;
  } catch (err) {
    console.warn(
      "[financial-accounts] asset ledger upload failed (serving via s3_link):",
      err
    );
    return null;
  }
}

// Best-effort ledger delete: a no-op when assets aren't wired or the id is null,
// and swallows errors (cleanup must never fail the request). Idempotent.
async function bestEffortDeleteAsset(
  deps: RouterDeps,
  assetId: number | null
): Promise<void> {
  if (assetId === null || !deps.assets) return;
  await deps.assets.delete(assetId).catch((err) => {
    console.warn(
      `[financial-accounts] asset ledger cleanup failed for ${assetId}:`,
      err
    );
  });
}

// GET / — balance-enriched list. escapeHatch reason: the generated list can't
// merge a peer-plugin `balance` field, so the list stays hand-authored (with the
// workspace filter injected by the surface and RLS biting under the wall).
function mountList(app: Hono, deps: RouterDeps): void {
  const { requireAuth, requireWorkspace, requirePermission } = deps;
  const data = makeDataSurface(deps.db);
  app.get(
    "/",
    requireAuth,
    requireWorkspace,
    requirePermission("financial_accounts.view"),
    async (c: Context) => {
      const status = c.req.query("status");
      const search = c.req.query("search");
      const sortBy = c.req.query("sortBy");
      const sortDir =
        c.req.query("sortDir")?.toUpperCase() === "ASC" ? "ASC" : "DESC";
      const page = Math.max(1, parseInt(c.req.query("page") || "") || 1);
      const limit = Math.min(parseInt(c.req.query("limit") || "") || 25, 200);
      const offset = (page - 1) * limit;

      try {
        // The surface ANDs `workspace_id = <ctx>` AFTER this fragment, so the
        // caller's WHERE never mentions workspace and its $N start at 1.
        const conditions: string[] = [];
        const params: (string | number | boolean)[] = [];

        if (status === "active" || !status || status === "") {
          conditions.push(`is_active = true`);
        } else if (status === "archived") {
          conditions.push(`is_active = false`);
        }

        if (search && search.trim()) {
          // Escape LIKE metachars so a `%`/`_` in user search input can't turn
          // into unintended wildcards (Lens 12 hard rule).
          const escaped = search.trim().replace(/([\\%_])/g, "\\$1");
          conditions.push(
            `(name ILIKE $${params.length + 1} ESCAPE '\\' OR description ILIKE $${
              params.length + 1
            } ESCAPE '\\')`
          );
          params.push(`%${escaped}%`);
        }

        const where = conditions.length ? conditions.join(" AND ") : undefined;
        const sortColumn = SORTABLE_COLUMNS.includes(sortBy || "")
          ? sortBy!
          : "created_at";

        const rows = await data.find<AccountRow>(
          "financial_accounts",
          ACCOUNT_COLS,
          {
            where,
            params,
            orderBy: `${sortColumn} ${sortDir}`,
            limit,
            offset,
          }
        );
        const total = await data.count("financial_accounts", { where, params });

        // Enrich with balances from the transactions plugin. When it's absent
        // (standalone deploy) balances is null and rows ship without `balance`
        // so the UI degrades to "—".
        const balances = await fetchBalances(
          deps.db,
          ctxGet(c, "workspaceId") as number,
          rows.map((r) => r.id)
        );
        const enriched = rows.map((r) => ({
          ...r,
          balance: balances[r.id]?.balance ?? 0,
        }));

        return c.json({
          data: enriched,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        });
      } catch (err) {
        console.error("[financial-accounts] list error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    }
  );
}

// GET /:id — balance-enriched single account. escapeHatch reason: same peer-RPC
// enrichment the generated GET /:id can't do (spec sets `get: false`).
function mountGet(app: Hono, deps: RouterDeps): void {
  const { requireAuth, requireWorkspace, requirePermission } = deps;
  const data = makeDataSurface(deps.db);
  app.get(
    "/:id",
    requireAuth,
    requireWorkspace,
    requirePermission("financial_accounts.view"),
    async (c: Context) => {
      // Guard the :id the same way the generated routes do (a non-numeric segment
      // is a 400, not a Postgres 22P02 → 500). Hono params are always strings.
      const id = parseInt(String(c.req.param("id")), 10);
      if (!Number.isFinite(id)) {
        return c.json({ error: "Invalid id" }, 400);
      }
      try {
        const account = await data.findOne<AccountRow>(
          "financial_accounts",
          ACCOUNT_COLS,
          {
            where: "id = $1",
            params: [id],
          }
        );
        if (!account) {
          return c.json({ error: "Not found" }, 404);
        }
        // Attach the real balance when transactions is loaded; otherwise leave
        // it unset so the UI shows "—".
        const balances = await fetchBalances(
          deps.db,
          ctxGet(c, "workspaceId") as number,
          [account.id]
        );
        return c.json({ ...account, balance: balances[account.id]?.balance ?? 0 });
      } catch (err) {
        console.error("[financial-accounts] get error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    }
  );
}

// POST /:id/logo — upload/replace the account logo. escapeHatch: S3 multipart
// I/O + best-effort orphan cleanup, byte-for-byte the monolith's.
function mountLogoUpload(app: Hono, deps: RouterDeps): void {
  const { requireAuth, requireWorkspace, requirePermission } = deps;
  const data = makeDataSurface(deps.db);
  app.post(
    "/:id/logo",
    requireAuth,
    requireWorkspace,
    requirePermission("financial_accounts.edit"),
    async (c: Context) => {
      const id = parseInt(String(c.req.param("id")), 10);
      if (!Number.isFinite(id)) {
        return c.json({ error: "Invalid id" }, 400);
      }
      if (!s3Enabled()) {
        return c.json({ error: "Logo storage is not configured" }, 503);
      }

      // Parse multipart form data (Hono's built-in, replaces multer).
      let body: Record<string, unknown>;
      try {
        body = await c.req.parseBody();
      } catch {
        return c.json({ error: "Logo upload failed" }, 400);
      }
      const file = body.file;
      if (!(file instanceof File)) {
        return c.json({ error: "file is required (multipart/form-data)" }, 400);
      }
      if (!LOGO_MIMES.includes(file.type)) {
        return c.json({ error: "Logo must be webp, png, or jpeg" }, 400);
      }
      if (file.size > MAX_LOGO_SIZE) {
        return c.json({ error: "Logo too large (max 5MB)" }, 413);
      }

      const wsId = c.get("workspaceId" as never) as number;
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const existing = await data.findOne<{
          s3_link: string | null;
          asset_id: number | null;
        }>("financial_accounts", ["s3_link", "asset_id"], {
          where: "id = $1",
          params: [id],
        });
        if (!existing) {
          return c.json({ error: "Not found" }, 404);
        }
        const oldS3Link = existing.s3_link;
        const oldAssetId = existing.asset_id;

        // The generated path builds the S3 key + public link; s3_link stays the
        // A1 final cut: upload PRIVATE — the logo is served only through the
        // ownership-scoped presigned-URL route, never the bare public object. The
        // ledger (asset_id) is now the read path; s3_link stays as a non-public
        // bookkeeping reference (the object is no longer world-readable).
        const logoPath = `financial-accounts/${wsId}/${crypto.randomUUID()}.webp`;
        const key = `uploads/${logoPath}`;
        // NOTE(A1 ops): existing logo objects uploaded BEFORE this retire stay
        // publicly served from the DigitalOcean Spaces CDN until a CDN purge
        // (`doctl compute cdn flush`) — the ACL flip alone doesn't evict cached
        // copies. New uploads (here) are already private.
        await s3PutObject(key, buffer, file.type, { acl: "private" });
        const s3Link = s3PublicUrl(key);

        // A1 dual-store: ALSO register the bytes in the kernel asset ledger so the
        // presigned-URL path can serve them. Best-effort — if the kernel/ledger is
        // unavailable the upload still succeeds on s3_link alone (asset_id null).
        const newAssetId = await uploadLogoToLedger(deps, buffer, file.type);

        const rows = await data.update<AccountRow>(
          "financial_accounts",
          { s3_link: s3Link, asset_id: newAssetId, updated_at: new Date() },
          { where: "id = $1", params: [id] },
          ACCOUNT_COLS
        );
        if (rows.length === 0) {
          // Row vanished between the SELECT and the UPDATE — drop both objects.
          await s3DeleteObject(key).catch(() => {});
          await bestEffortDeleteAsset(deps, newAssetId);
          return c.json({ error: "Not found" }, 404);
        }
        // Replacing a logo orphans the previous object + ledger row — best-effort
        // cleanup of both.
        const oldKey = s3KeyFromUrl(oldS3Link);
        if (oldKey && oldKey !== key) {
          await s3DeleteObject(oldKey).catch((cleanupErr) => {
            console.warn(
              `[financial-accounts] s3 cleanup failed for ${oldKey}:`,
              cleanupErr
            );
          });
        }
        if (oldAssetId !== newAssetId) {
          await bestEffortDeleteAsset(deps, oldAssetId);
        }
        return c.json(rows[0]);
      } catch (err) {
        console.error("[financial-accounts] logo upload error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    }
  );
}

// DELETE /:id/logo — remove the account logo. escapeHatch: S3 removal +
// best-effort cleanup, byte-for-byte the monolith's.
function mountLogoDelete(app: Hono, deps: RouterDeps): void {
  const { requireAuth, requireWorkspace, requirePermission } = deps;
  const data = makeDataSurface(deps.db);
  app.delete(
    "/:id/logo",
    requireAuth,
    requireWorkspace,
    requirePermission("financial_accounts.edit"),
    async (c: Context) => {
      const id = parseInt(String(c.req.param("id")), 10);
      if (!Number.isFinite(id)) {
        return c.json({ error: "Invalid id" }, 400);
      }
      try {
        const existing = await data.findOne<{
          s3_link: string | null;
          asset_id: number | null;
        }>("financial_accounts", ["s3_link", "asset_id"], {
          where: "id = $1",
          params: [id],
        });
        if (!existing) {
          return c.json({ error: "Not found" }, 404);
        }
        const oldS3Link = existing.s3_link;
        const oldAssetId = existing.asset_id;

        const rows = await data.update<AccountRow>(
          "financial_accounts",
          { s3_link: null, asset_id: null, updated_at: new Date() },
          { where: "id = $1", params: [id] },
          ACCOUNT_COLS
        );
        if (rows.length === 0) {
          return c.json({ error: "Not found" }, 404);
        }
        // The row no longer references the object or ledger row — best-effort
        // removal of both. Idempotent: a null oldAssetId skips the ledger call.
        const oldKey = s3KeyFromUrl(oldS3Link);
        if (oldKey) {
          await s3DeleteObject(oldKey).catch((cleanupErr) => {
            console.warn(
              `[financial-accounts] s3 cleanup failed for ${oldKey}:`,
              cleanupErr
            );
          });
        }
        await bestEffortDeleteAsset(deps, oldAssetId);
        return c.json(rows[0]);
      } catch (err) {
        console.error("[financial-accounts] logo delete error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    }
  );
}

// GET /:id/logo/raw — stream the account logo's bytes back through this authed
// route (the proxy/blob pattern). The private object is NEVER exposed at a public
// or signed URL: the data surface ANDs workspace_id (RLS is the second wall), so a
// cross-workspace id 404s, and the UI renders the streamed bytes as a same-origin
// blob:. Serving is plugin-local (the row's own s3_link key), independent of the
// kernel asset ledger — the ledger still records the upload (asset_id) for tracking.
function mountLogoRaw(app: Hono, deps: RouterDeps): void {
  const { requireAuth, requireWorkspace, requirePermission } = deps;
  const data = makeDataSurface(deps.db);
  app.get(
    "/:id/logo/raw",
    requireAuth,
    requireWorkspace,
    requirePermission("financial_accounts.view"),
    async (c: Context) => {
      const id = parseInt(String(c.req.param("id")), 10);
      if (!Number.isFinite(id)) {
        return c.json({ error: "Invalid id" }, 400);
      }
      try {
        const row = await data.findOne<{ s3_link: string | null }>(
          "financial_accounts",
          ["s3_link"],
          { where: "id = $1", params: [id] },
        );
        const key = row ? s3KeyFromUrl(row.s3_link) : null;
        if (!key) {
          return c.json({ error: "No logo" }, 404);
        }
        const { body, contentType } = await s3GetObject(key);
        return c.body(new Uint8Array(body), {
          headers: {
            "Content-Type": contentType || "application/octet-stream",
            "Cache-Control": "private, max-age=300",
          },
        });
      } catch (err) {
        console.error("[financial-accounts] logo raw error:", err);
        return c.json({ error: "Internal server error" }, 500);
      }
    }
  );
}

/**
 * Build the plugin's Hono app. The standalone server mounts it at "/"; the kernel
 * reverse-proxies its basePath (/api/financial-accounts) here with the prefix
 * stripped. The escape-hatch routes mount BEFORE the generated CRUD router so the
 * balance-enriched list `/` and the static `/:id/logo` win over the generated
 * routes (and the generated `GET /:id` is suppressed via `get: false`).
 */
export function buildRouter(deps: RouterDeps): Hono {
  const inner = new Hono();
  mountList(inner, deps);
  mountGet(inner, deps);
  mountLogoUpload(inner, deps);
  mountLogoDelete(inner, deps);
  mountLogoRaw(inner, deps);
  inner.route("/", buildResourceRouter(accountsResource, deps));
  // Kernel proxies `/api/financial-accounts` here WITHOUT stripping the
  // prefix (additionalBasePaths mount, matches payees), so nest under the full
  // prefix so escape-hatch `/` + `/:id` route matches survive the merged mount.
  const app = new Hono();
  app.route("/api/financial-accounts", inner);
  return app;
}
