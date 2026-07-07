// Seeded from the verified flow recon — the plugin's §9 interaction
// graph as node steps. Authored with the SDK buildFlow DSL; served at
// /__meta/flows for the kernel to render. Edit by hand; ExecFlow nodes execute via runFlow.
import {
  buildFlow,
  type FlowDefinition,
  type ExecFlow,
  type FlowContext,
} from "@kahitsan/plugin-sdk/flow";
import { analyticsFlows } from "./flows-analytics.js";

// EXECUTABLE flows (Vision §9): the same objects the kernel renders (JSON.stringify
// drops the functions → structure-only) are what the UI dispatches via runFlow.
// One source — the diagram cannot drift from the behaviour.

// Void a transaction (admin soft-delete). Mirrors handleVoid: DELETE the txn,
// then close the detail sheet + refresh the list + reload subcategory counts.
export const voidFlow: ExecFlow = {
  id: "transactions.void.exec",
  title: "Void Transaction",
  nodes: [
    {
      id: "void",
      kind: "trigger",
      label: "Confirm void",
      out: [{ id: "o", to: "commit" }],
    },
    {
      id: "commit",
      kind: "commit",
      label: "Void transaction (soft-delete)",
      detail: "DELETE /api/transactions/:id → status='voided'",
      request: (ctx: FlowContext) => ({
        url: `/api/transactions/${ctx.state.id}`,
        method: "DELETE",
      }),
      out: [{ id: "o", to: "refresh" }],
    },
    {
      id: "refresh",
      kind: "effect",
      label: "Close detail, refresh list + counts",
      effect: "refresh",
      out: [{ id: "o", to: "done" }],
    },
    { id: "done", kind: "terminal", label: "Transaction voided" },
  ],
};

// Delete a single payment leg. Mirrors handleDeletePayment AFTER its confirm()
// gate (the confirm stays in the UI): DELETE the leg, then on success reopen the
// detail + refresh the list (balance rises); on failure surface the error.
export const deletePaymentFlow: ExecFlow = {
  id: "transactions.delete-payment.exec",
  title: "Delete Payment",
  nodes: [
    {
      id: "del",
      kind: "trigger",
      label: "Confirm delete payment",
      out: [{ id: "o", to: "commit" }],
    },
    {
      id: "commit",
      kind: "commit",
      label: "Delete payment leg",
      detail: "DELETE /api/transactions/:id/payments/:pid",
      request: (ctx: FlowContext) => ({
        url: `/api/transactions/${ctx.state.id}/payments/${ctx.state.paymentId}`,
        method: "DELETE",
      }),
      out: [{ id: "o", to: "ok" }],
    },
    {
      id: "ok",
      kind: "condition",
      label: "Delete OK?",
      when: (ctx: FlowContext) => (ctx.state.commit ? "yes" : "no"),
      out: [
        { id: "yes", to: "refresh", label: "yes" },
        { id: "no", to: "error", label: "no" },
      ],
    },
    {
      id: "refresh",
      kind: "effect",
      label: "Reload detail + refresh list (balance rises)",
      effect: "refresh",
      out: [{ id: "o", to: "done" }],
    },
    {
      id: "error",
      kind: "effect",
      label: "Show delete error",
      effect: "toast",
      out: [{ id: "o", to: "done" }],
    },
    { id: "done", kind: "terminal", label: "Payment deleted" },
  ],
};

// Delete one attachment. Mirrors handleDeleteAttachment: DELETE the attachment,
// then on success merge-out of the open detail + refresh the list; on failure
// surface the server error message.
export const deleteAttachmentFlow: ExecFlow = {
  id: "transactions.delete-attachment.exec",
  title: "Delete Attachment",
  nodes: [
    {
      id: "del",
      kind: "trigger",
      label: "Delete an attachment",
      out: [{ id: "o", to: "commit" }],
    },
    {
      id: "commit",
      kind: "commit",
      label: "Delete attachment",
      detail: "DELETE /api/transactions/:id/attachments/:aid",
      request: (ctx: FlowContext) => ({
        url: `/api/transactions/${ctx.state.id}/attachments/${ctx.state.attachmentId}`,
        method: "DELETE",
      }),
      out: [{ id: "o", to: "ok" }],
    },
    {
      id: "ok",
      kind: "condition",
      label: "Delete OK?",
      when: (ctx: FlowContext) => (ctx.state.commit ? "yes" : "no"),
      out: [
        { id: "yes", to: "refresh", label: "yes" },
        { id: "no", to: "error", label: "no" },
      ],
    },
    {
      id: "refresh",
      kind: "effect",
      label: "Merge out of gallery, refresh count",
      effect: "refresh",
      out: [{ id: "o", to: "done" }],
    },
    {
      id: "error",
      kind: "effect",
      label: "Show delete error",
      effect: "toast",
      out: [{ id: "o", to: "done" }],
    },
    { id: "done", kind: "terminal", label: "Gallery updated" },
  ],
};

export const flows: FlowDefinition[] = [
  buildFlow("transactions.board", "Transactions Ledger", (f) => {
    const n_list = f.data(
      "Transaction list",
      "GET /api/transactions (paged, sortable, search by description/payee/notes, date-range)"
    );
    const n_resolve_names = f.call(
      "clients.findByIds + financial-accounts/payees lookups on read; sets peersUnavailable on 503",
      "Resolve account / payee / client names"
    );
    const n_filters = f.data(
      "Filters: category, status, account, subcategory, created-by, PDC",
      "useTransactionFilters → merged into list fetch params; subcategory counts loaded alongside"
    );
    const n_trg_group = f.trigger("Toggle 'Group sales by day'");
    const n_grouped = f.load(
      "Load per-day aggregated rows",
      "GET /api/transactions/grouped-by-date (date,count,total per day)"
    );
    const n_row_click = f.trigger("Click a row");
    const n_cond_grouped = f.condition("Aggregated day row?");
    const n_expand = f.load(
      "Lazy-load that day's transactions",
      "useLazyDayGroups → expands inline under the day row"
    );
    const n_open_detail = f.load(
      "Open transaction detail",
      "GET /api/transactions/:id (line items, payments, attachments, visibility)"
    );
    const n_detail_modal = f.modal("Transaction detail sheet");
    const n_trg_add = f.trigger("Record Transaction button");
    const n_create_modal = f.modal("Record transaction form");
    const n_trg_export = f.trigger("Export button");
    const n_export_modal = f.modal("Export CSV modal");
    const n_trg_share = f.trigger("Share button (PageShareButton)");
    const n_terminal_view = f.terminal("Detail / day rows open");
    const n_terminal_add = f.terminal("Create form open");
    const n_terminal_export = f.terminal("Export open");
    const n_terminal_share = f.terminal("Share panel open");
    n_list.to(n_row_click);
    n_list.to(n_trg_add);
    n_list.to(n_trg_export);
    n_list.to(n_trg_share);
    n_resolve_names.to(n_list);
    n_filters.to(n_list);
    n_trg_group.to(n_grouped);
    n_grouped.to(n_list);
    n_row_click.to(n_cond_grouped);
    n_cond_grouped.to(n_expand, "yes (grouped)");
    n_cond_grouped.to(n_open_detail, "no (single txn)");
    n_expand.to(n_terminal_view);
    n_open_detail.to(n_detail_modal);
    n_detail_modal.to(n_terminal_view);
    n_trg_add.to(n_create_modal);
    n_create_modal.to(n_terminal_add);
    n_trg_export.to(n_export_modal);
    n_export_modal.to(n_terminal_export);
    n_trg_share.to(n_terminal_share);
  }),
  buildFlow("transactions.create", "Record Transaction", (f) => {
    const n_trg = f.trigger("Record Transaction button");
    const n_load_ref = f.load(
      "Reset form + load members & accounts",
      "resetForm + loadOrgMembers; accounts/subcategory reference"
    );
    const n_modal = f.modal("Transaction form");
    const n_submit = f.trigger("Click Create Transaction");
    const n_validate = f.compute("Validate description + amount");
    const n_cond_valid = f.condition("Description + amount OK?");
    const n_cond_backdate = f.condition("Backdated entry?");
    const n_check_backdate = f.compute("Require backdate permission + reason");
    const n_cond_backdate_ok = f.condition("Allowed + reason given?");
    const n_err = f.effect("Show inline error");
    const n_cond_sale = f.condition("Sale WITH package cart?");
    const n_call_pkg = f.call(
      "packages.findVariantsByIds — checks each variant exists & matches package_id",
      "Validate package variants"
    );
    const n_cond_pkg_up = f.condition("Packages plugin available?");
    const n_err_503 = f.effect("Reject: packages plugin unavailable");
    const n_cond_voucher = f.condition("Voucher on cart?");
    const n_call_voucher = f.call(
      "vouchers.findByCode (top-level) / findById (per-group); absent → no discount",
      "Resolve + price voucher"
    );
    const n_compute_discount = f.compute("total = subtotal − discount");
    const n_commit_sale = f.commit(
      "Charge sale (single DB txn)",
      "POST /api/transactions/charge → INSERT transactions + line_items (+ customer_groups) + payment leg"
    );
    const n_commit_manual = f.commit(
      "Create expense / payable / business / manual sale",
      "POST /api/transactions"
    );
    const n_upload = f.effect("Upload pending attachments");
    const n_refresh = f.effect(
      "Close modal, refresh list + subcategory counts"
    );
    const n_done = f.terminal("Transaction recorded");
    n_trg.to(n_load_ref);
    n_load_ref.to(n_modal);
    n_modal.to(n_submit);
    n_submit.to(n_validate);
    n_validate.to(n_cond_valid);
    n_cond_valid.to(n_cond_backdate, "yes");
    n_cond_valid.to(n_err, "no");
    n_cond_backdate.to(n_check_backdate, "yes (date≠today)");
    n_cond_backdate.to(n_cond_sale, "no");
    n_check_backdate.to(n_cond_backdate_ok);
    n_cond_backdate_ok.to(n_cond_sale, "yes");
    n_cond_backdate_ok.to(n_err, "no");
    n_err.to(n_modal);
    n_cond_sale.to(n_call_pkg, "yes (charge path)");
    n_cond_sale.to(n_commit_manual, "no (manual path)");
    n_call_pkg.to(n_cond_pkg_up);
    n_cond_pkg_up.to(n_cond_voucher, "yes");
    n_cond_pkg_up.to(n_err_503, "no");
    n_err_503.to(n_modal);
    n_cond_voucher.to(n_call_voucher, "yes");
    n_cond_voucher.to(n_commit_sale, "no");
    n_call_voucher.to(n_compute_discount);
    n_compute_discount.to(n_commit_sale);
    n_commit_sale.to(n_upload);
    n_commit_manual.to(n_upload);
    n_upload.to(n_refresh);
    n_refresh.to(n_done);
  }),
  buildFlow("transactions.edit", "Edit Transaction", (f) => {
    const n_detail = f.data(
      "Open detail sheet",
      "GET /api/transactions/:id (non-voided, has create/edit perm)"
    );
    const n_trg_edit = f.trigger("Edit button");
    const n_populate = f.compute("Populate form from transaction");
    const n_form = f.modal("Edit form (inline in sheet)");
    const n_save = f.trigger("Click Save Changes");
    const n_validate = f.compute("Validate description + amount");
    const n_cond = f.condition("Valid?");
    const n_err = f.effect("Show inline error");
    const n_commit = f.commit(
      "Update transaction",
      "PUT /api/transactions/:id (full field set; sales re-send the cart + voucher delta)"
    );
    const n_cond_priv = f.condition("Marked private?");
    const n_visibility = f.commit(
      "Save per-user / per-role share list",
      "PUT /api/transactions/:id/visibility"
    );
    const n_upload = f.effect("Upload new attachments");
    const n_reopen = f.effect("Reopen detail + refresh list & counts");
    const n_done = f.terminal("Changes saved");
    n_detail.to(n_trg_edit);
    n_trg_edit.to(n_populate);
    n_populate.to(n_form);
    n_form.to(n_save);
    n_save.to(n_validate);
    n_validate.to(n_cond);
    n_cond.to(n_commit, "yes");
    n_cond.to(n_err, "no");
    n_err.to(n_form);
    n_commit.to(n_cond_priv);
    n_cond_priv.to(n_visibility, "yes");
    n_cond_priv.to(n_upload, "no");
    n_visibility.to(n_upload);
    n_upload.to(n_reopen);
    n_reopen.to(n_done);
  }),
  buildFlow("transactions.void", "Void Transaction", (f) => {
    const n_detail = f.data(
      "Open detail sheet (admin)",
      "requires transactions.delete; only on non-voided txns"
    );
    const n_trg_void = f.trigger("Void button");
    const n_confirm = f.modal("Void confirmation banner");
    const n_cond = f.condition("Confirm void?");
    const n_cancel = f.effect("Dismiss banner");
    const n_commit = f.commit(
      "Void transaction (soft-delete)",
      "DELETE /api/transactions/:id → status='voided'"
    );
    const n_refresh = f.effect("Close detail, refresh list + counts");
    const n_done = f.terminal("Transaction voided");
    n_detail.to(n_trg_void);
    n_trg_void.to(n_confirm);
    n_confirm.to(n_cond);
    n_cond.to(n_commit, "yes");
    n_cond.to(n_cancel, "no");
    n_cancel.to(n_detail);
    n_commit.to(n_refresh);
    n_refresh.to(n_done);
  }),
  buildFlow(
    "transactions.record-payment",
    "Record Payment (Settle Leg)",
    (f) => {
      const n_detail = f.data(
        "Open sale detail",
        "detail sheet with outstanding balance"
      );
      const n_trg = f.trigger("Record payment button");
      const n_open_modal = f.load(
        "Load payment ledger + balance",
        "GET /api/transactions/:id (payments[] + balance)"
      );
      const n_load_acc = f.call(
        "GET /api/financial-accounts (sibling plugin); degrades to numeric account-id input on failure",
        "Load payment accounts"
      );
      const n_seed = f.compute("Seed amount from mode");
      const n_modal = f.modal("Payment history + add-tender form");
      const n_submit = f.trigger("Click Record payment");
      const n_validate = f.compute("Validate amount>0 + account chosen");
      const n_cond = f.condition("Valid?");
      const n_err = f.effect("Show inline error");
      const n_commit = f.commit(
        "Record payment leg",
        "POST /api/transactions/:id/payments {financial_account_id, amount, notes}"
      );
      const n_refresh = f.effect(
        "Reload ledger, refresh list, back to history"
      );
      const n_done = f.terminal("Payment recorded");
      n_detail.to(n_trg);
      n_trg.to(n_open_modal);
      n_open_modal.to(n_load_acc);
      n_load_acc.to(n_seed);
      n_seed.to(n_modal);
      n_modal.to(n_submit);
      n_submit.to(n_validate);
      n_validate.to(n_cond);
      n_cond.to(n_commit, "yes");
      n_cond.to(n_err, "no");
      n_err.to(n_modal);
      n_commit.to(n_refresh);
      n_refresh.to(n_done);
    }
  ),
  buildFlow("transactions.delete-payment", "Delete Payment", (f) => {
    const n_ledger = f.data(
      "Payment history list",
      "txn.payments in detail / PaymentLegModal"
    );
    const n_trg = f.trigger("Delete payment (per leg)");
    const n_confirm = f.modal("Confirm delete payment");
    const n_cond = f.condition("Confirm?");
    const n_cancel = f.terminal("Cancelled");
    const n_commit = f.commit(
      "Delete payment leg",
      "DELETE /api/transactions/:id/payments/:pid"
    );
    const n_refresh = f.effect("Reload detail + refresh list (balance rises)");
    const n_done = f.terminal("Payment deleted");
    n_ledger.to(n_trg);
    n_trg.to(n_confirm);
    n_confirm.to(n_cond);
    n_cond.to(n_commit, "yes");
    n_cond.to(n_cancel, "no");
    n_commit.to(n_refresh);
    n_refresh.to(n_done);
  }),
  buildFlow("transactions.attachments", "Manage Attachments", (f) => {
    const n_detail = f.data("Detail attachment gallery");
    const n_trg_upload = f.trigger("Pick files to upload");
    const n_optimistic = f.effect("Show optimistic upload tiles");
    const n_commit_up = f.commit(
      "Upload attachment",
      "POST /api/transactions/:id/attachments (multipart, field 'file')"
    );
    const n_cond_up = f.condition("Upload OK?");
    const n_err_up = f.effect("Flag failed file names");
    const n_merge = f.effect("Merge into gallery, refresh count");
    const n_trg_del = f.trigger("Delete an attachment");
    const n_commit_del = f.commit(
      "Delete attachment",
      "DELETE /api/transactions/:id/attachments/:aid"
    );
    const n_done = f.terminal("Gallery updated");
    n_detail.to(n_trg_upload);
    n_detail.to(n_trg_del);
    n_trg_upload.to(n_optimistic);
    n_optimistic.to(n_commit_up);
    n_commit_up.to(n_cond_up);
    n_cond_up.to(n_merge, "yes");
    n_cond_up.to(n_err_up, "no");
    n_err_up.to(n_merge);
    n_merge.to(n_done);
    n_trg_del.to(n_commit_del);
    n_commit_del.to(n_merge);
  }),
  buildFlow("transactions.export", "Export Transactions CSV", (f) => {
    const n_trg = f.trigger("Export button");
    const n_recent = f.load(
      "Load recent export jobs",
      "GET /api/transactions/export (jobs[])"
    );
    const n_modal = f.modal("Pick date range + consolidate option");
    const n_submit = f.trigger("Click Prepare CSV");
    const n_cond = f.condition("Range valid (start≤end, ≤730 days)?");
    const n_err = f.effect("Show range error");
    const n_commit = f.commit(
      "Start export job",
      "POST /api/transactions/export → {jobId}"
    );
    const n_stream = f.load(
      "Stream progress (SSE)",
      "EventSource /export/:jobId/progress — progress/done/error events"
    );
    const n_cond_done = f.condition("Job finished OK?");
    const n_download = f.effect("Auto-download CSV + refresh recent");
    const n_trg_redl = f.trigger("Re-download a recent export");
    const n_redl = f.effect("Download existing file");
    const n_done = f.terminal("Export downloaded");
    n_trg.to(n_recent);
    n_recent.to(n_modal);
    n_modal.to(n_submit);
    n_modal.to(n_trg_redl);
    n_submit.to(n_cond);
    n_cond.to(n_commit, "yes");
    n_cond.to(n_err, "no");
    n_err.to(n_modal);
    n_commit.to(n_stream);
    n_stream.to(n_cond_done);
    n_cond_done.to(n_download, "done");
    n_cond_done.to(n_err, "error");
    n_download.to(n_done);
    n_trg_redl.to(n_redl);
    n_redl.to(n_done);
  }),
  // Folded-in Analytics dashboard flows (analytics.board/filter/rightrail/retry/
  // share/workspace_switch + the executable retryFlow) — one bundle, one process.
  ...analyticsFlows,
];
