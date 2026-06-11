// Transactions plugin — the single router mounted at basePath /api/transactions.
//
// The fork proxies ONE basePath per plugin. The monolith mounted three roots
// (/api/transactions, /api/transaction-line-items, /api/transaction-subcategories);
// here they ALL live under /api/transactions, with the kernel stripping the
// prefix so routes mount relative to "/":
//   GET    /                       list (pagination/sort/filters/search)
//   POST   /                       create (manual income/expense/business)
//   GET    /subcategories          list taxonomy (?applies_to=income|expense)
//   POST   /subcategories          create a subcategory
//   PUT    /subcategories/:id      edit a subcategory
//   DELETE /subcategories/:id      soft-delete a subcategory
//   GET    /creators               distinct creators (filter dropdown)
//   GET    /subcategory-counts     per-subcategory counts
//   GET    /outstanding            unpaid sales (Counter board)
//   POST   /charge                 POS charge flow (RPC to packages/vouchers/clients)
//   GET    /:id                    detail (line items, payments, edits, visibility)
//   PUT    /:id                    edit basic fields
//   DELETE /:id                    soft-delete (status='voided')
//   POST   /:id/void               void with reason
//   POST   /:id/unvoid             un-void
//   PUT    /:id/visibility         replace per-user / per-role share grants
//   GET    /:id/payments           list payment legs
//   POST   /:id/payments           add a settlement leg
//   DELETE /:id/payments/:pid      remove a leg
//   GET    /:id/line-items         list line items
//   POST   /:id/line-items/:lid/void   void a single line item
//   GET    /:id/attachments        list attachments (metadata)
//   POST   /:id/attachments        attach a file (multipart form: field "file")
//   DELETE /:id/attachments/:aid   delete an attachment
//
// Every query carries WHERE organization_id = $N from req.organizationId
// (forwarded by the kernel in the signed identity). Cross-plugin data
// (package/variant/client names, voucher discount) is resolved over the kernel
// RPC (lib/peers.ts) with graceful degradation when a peer plugin is absent —
// transactions never reaches into another plugin's schema with raw SQL.

import { Router, type RequestHandler } from "express";
import type { PluginDb } from "@ks-erp/kernel/services/database";
import { validateVoucher } from "./lib/peers.js";
import { appliesToFor } from "./lib/transaction-subcategories.js";
import { registerSubcategoryRoutes } from "./routes/subcategories.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerChargeRoutes } from "./routes/charge.js";
import { registerCoreRoutes, registerCounterPatchRoutes } from "./routes/transactions-core.js";
import { registerPaymentUpdateRoute, registerPaymentRoutes } from "./routes/payments.js";
import { registerAttachmentRoutes } from "./routes/attachments.js";

export type RouterDeps = {
  db: PluginDb;
  requireAuth: RequestHandler;
  requireOrg: RequestHandler;
  requirePermission: (...codes: string[]) => RequestHandler;
};

export function buildRouter(deps: RouterDeps): Router {
  const router = Router();
  const { db: pool, requireAuth, requireOrg, requirePermission } = deps;

  // ── Subcategory taxonomy (formerly /api/transaction-subcategories) ───────
  // The four subcategory CRUD handlers live in ./routes/subcategories.ts;
  // registered here so they keep their original position ahead of "/:id".
  registerSubcategoryRoutes(router, { pool, requireAuth, requireOrg, requirePermission });

  // ── Payment edit (PUT /:id/payments/:paymentId) ──────────────────────────
  // Registered here so it keeps its original early position (ahead of the
  // analytics/charge reads); the GET/POST/DELETE payment trio is registered
  // later via registerPaymentRoutes. Lives in ./routes/payments.ts.
  registerPaymentUpdateRoute(router, { pool, requireAuth, requireOrg, requirePermission });

  // ── Analytics + filter-support reads (formerly inline here) ──────────────
  // The literal-segment GET reads (/subscriptions + renew, /creators,
  // /subcategory-counts, /summary, /cashflow, /by-hour) live in
  // ./routes/analytics.ts; registered here so they keep their original position
  // ahead of "/:id" (literal segments must win over the :id capture).
  registerAnalyticsRoutes(router, { pool, requireAuth, requireOrg, requirePermission });

  // ── Counter-board reads + the POS charge flow (formerly inline here) ─────
  // GET /outstanding (unpaid sales) + POST /charge (thin wrapper over runCharge)
  // live in ./routes/charge.ts; registered here so they keep their original
  // position ahead of "/:id" — the literal segments win.
  registerChargeRoutes(router, { pool, requireAuth, requireOrg, requirePermission });

  // ── Core CRUD reads + writes (formerly inline here) ──────────────────────
  // GET / (list), POST / (create), GET/PUT/DELETE /:id, POST /:id/void +
  // /:id/unvoid, PUT /:id/visibility, GET /:id/line-items + the line-item void.
  // Live in ./routes/transactions-core.ts; registered here so the "/:id"
  // routes keep their original position — after the literal-segment reads
  // (subcategories/analytics/charge) so those win the Express match.
  registerCoreRoutes(router, { pool, requireAuth, requireOrg, requirePermission });

  // ── Payments (GET list, POST add, DELETE remove) ─────────────────────────
  // The PUT edit-leg route was registered earlier (registerPaymentUpdateRoute);
  // this trio keeps its original later position. Lives in ./routes/payments.ts.
  registerPaymentRoutes(router, { pool, requireAuth, requireOrg, requirePermission });

  // ── Attachments (multipart file upload) ──────────────────────────────────
  // GET/POST/DELETE /:id/attachments. The multer/crypto/node:path imports and
  // the S3 client helpers live in ./routes/attachments.ts.
  registerAttachmentRoutes(router, { pool, requireAuth, requireOrg, requirePermission });

  // ── Counter PATCH routes (client-pool, customer-group started-at/client) ──
  // Registered LAST so they keep their original position after the attachment
  // routes. Live in ./routes/transactions-core.ts.
  registerCounterPatchRoutes(router, { pool, requireAuth, requireOrg, requirePermission });

  return router;
}

// Re-export so main.ts can build the transactions.service handlers using the
// same RPC helpers (capacity usage / findById) the monolith's extension point
// exposed.
export { validateVoucher, appliesToFor };
