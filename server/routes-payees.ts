import { Hono, type MiddlewareHandler } from "hono";
import type { PluginDb, DefinedResource } from "@kahitsan/plugin-sdk";
import { Types, defineResource, statusFilter, buildResourceRouter } from "@kahitsan/plugin-sdk";

// Payees / vendors / customers / billers — folded IN from the retired standalone
// payees plugin. The entire CRUD surface (list/get/create/update/archive/restore
// + the findByIds RPC) is generated at runtime from the `payeesResource` spec by
// the kernel resource runtime; the spec IS the feature, byte-for-behavior with
// the former plugin. Every read/write runs through the F3 data surface, which
// injects `AND workspace_id = <ctx>` structurally; the RLS/GRANT triad (adopted
// in migrations transactions_0011/0012) is the second wall.
//
// The table lives UNQUALIFIED as `payees` and resolves to public.payees via this
// process's `accounts, public` search_path — accounts has no `payees`, so there
// is no ambiguity, and the adopted migration keeps the table in public (no move).

const KINDS = ["vendor", "customer", "both"] as const;
type Kind = (typeof KINDS)[number];

/** Type guard pinning the payee `kind` allow-list (used by the list filter + create coercion). */
function isKind(v: unknown): v is Kind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

const payeesResource: DefinedResource = defineResource({
  name: "payee",
  table: "payees",
  schema: {
    name: Types.TEXT({ notNull: true }),
    kind: Types.ENUM(KINDS, { notNull: true, default: "vendor" }),
    default_subcategory: Types.TEXT(),
    notes: Types.TEXT(),
    is_active: Types.BOOLEAN({ notNull: true, default: true }),
    created_at: Types.TIMESTAMP({ notNull: true, default: "now" }),
    updated_at: Types.TIMESTAMP({ notNull: true, default: "now" }),
  },
  indexes: [
    { name: "idx_payees_org_active_name", columns: ["workspace_id", "is_active", "name"] },
    {
      name: "idx_payees_org_name_kind_unique",
      unique: true,
      columns: ["workspace_id", { ci: "name" }, "kind"],
    },
  ],
  softDelete: { column: "is_active" },
  touchOnWrite: "updated_at",
  list: {
    search: { fields: ["name"] },
    sort: {
      allow: ["name", "kind", "created_at", "updated_at", "is_active"],
      default: { field: "name", dir: "ASC" },
    },
    pagination: { defaultLimit: 25, maxLimit: 200 },
    filters: [
      statusFilter({ param: "status", column: "is_active", defaultValue: "active" }),
      {
        param: "kind",
        build: (v) => {
          if (!isKind(v)) return null;
          // Always include 'both' so a kind filter doesn't hide dual-purpose payees.
          if (v === "vendor" || v === "customer")
            return { sql: "(kind = ? OR kind = 'both')", params: [v] };
          return { sql: "kind = ?", params: [v] };
        },
      },
    ],
  },
  create: {
    fields: {
      name: { required: true, trim: true },
      kind: { coerce: (v) => (isKind(v) ? v : "vendor") },
      default_subcategory: { trimOrNull: true },
      notes: { trimOrNull: true },
    },
    conflict: {
      target: ["workspace_id", { ci: "name" }, "kind"],
      message: "A payee with this name and kind already exists",
    },
  },
  update: {
    fields: {
      name: { notEmpty: true, trim: true },
      kind: { oneOf: KINDS },
      default_subcategory: { trimOrNull: true },
      notes: { trimOrNull: true },
    },
  },
  responseColumns: [
    "id",
    "workspace_id",
    "name",
    "kind",
    "default_subcategory",
    "notes",
    "is_active",
    "created_at",
    "updated_at",
  ],
  services: { findByIds: { columns: ["id", "name", "kind"] } },
  // Per-action RBAC enforced in-process by the generated router (the proxy does
  // not gate per-action). Matches the manifest's `payees.*` permissions.
  permissions: { key: "payees" },
});

export type PayeesRouterDeps = {
  db: PluginDb;
  requireAuth: MiddlewareHandler;
  requireWorkspace: MiddlewareHandler;
  requirePermission: (...codes: string[]) => MiddlewareHandler;
};

/**
 * Build the payees router mounted at the FULL `/api/payees` prefix. Unlike the
 * primary transactions router (proxied prefix-STRIPPED, routes at "/"), payees
 * is an `additionalBasePaths` sibling the kernel forwards UNSTRIPPED — so the
 * spec's generated routes (at "/", "/:id", …) are nested under `/api/payees`.
 */
export function buildPayeesRouter(deps: PayeesRouterDeps): Hono {
  const app = new Hono();
  app.route("/api/payees", buildResourceRouter(payeesResource, deps));
  return app;
}
