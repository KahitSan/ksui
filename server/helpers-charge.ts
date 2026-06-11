// Counter "charge" (POS) flow for the isolated transactions plugin.
//
// BARREL. The charge engine was decomposed on its existing function seams into
// server/charge/* (validate, insert-line-items, probe-voucher, run-charge);
// this file re-exports the original public surface VERBATIM so every caller —
// notably routes/charge.ts (runCharge, ChargeValidationError, ChargePayload) —
// keeps importing from "./helpers-charge.js" unchanged. No SQL/logic/signature
// changed in the split.
//
// Faithful port of the monolith's helpers-charge.ts core path, with the
// in-process extension points replaced by the kernel RPC (lib/peers.ts) and
// graceful degradation when a peer plugin is absent. One accounts.transactions
// row + one accounts.transaction_line_items row per cart line + one optional
// accounts.transaction_payments leg, all inside a single DB transaction.
//
// What changed from the monolith (and why):
//   - Package/variant validation goes through packages.findVariantsByIds over
//     RPC. If the packages plugin is OFF, lines that carry a package_id/
//     package_variant_id are REJECTED with a clear message (manual line items
//     with no package ref still work). This is the graceful-degradation
//     contract for the producer transactions DEPENDS on at charge time.
//   - Voucher discount goes through vouchers.validate / findByCode over RPC.
//     If the vouchers plugin is OFF, no discount is applied and the charge
//     proceeds at full subtotal.
//   - Voucher usage increment is NOT part of the charge DB transaction (it
//     can't be — the producer is a separate process). The route does a
//     best-effort increment after commit; see routes.ts. A failed increment
//     never rolls back a committed charge.
//   - The monolith's `links.create` shadow-write (a Phase-8 migration artifact)
//     is dropped — there is no cross-process links runner and the in-row FK
//     column (package_variant_id) is the source of truth here.
//   - Client-name attribution is resolved on READ via clients.findByIds, not
//     joined in SQL; the charge just stores client_id.

export {
  ChargeValidationError,
  validateLineItems,
  validateChargePayload,
  validateCustomerGroups,
  type ChargeLineInput,
  type ChargeCustomerGroup,
  type ChargePayload,
  type ChargeResult,
} from "./charge/validate.js";

export {
  insertLineItemsForTransaction,
  type InsertLineItemsOptions,
} from "./charge/insert-line-items.js";

export { runCharge, type ChargeConnectHandle } from "./charge/run-charge.js";
