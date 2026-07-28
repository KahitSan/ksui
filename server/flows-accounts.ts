// Seeded from the verified flow recon — the plugin's §9 interaction
// graph as node steps. Authored with the SDK buildFlow DSL; served at
// /__meta/flows for the kernel to render. Edit by hand; ExecFlow nodes execute via runFlow.
import {
  buildFlow,
  type FlowDefinition,
  type ExecFlow,
  type FlowContext,
} from "@kahitsan/plugin-sdk/flow"; // /flow subpath: the bundle that actually exports the flow DSL + types

/**
 * EXECUTABLE flows (Vision §9): the same objects the kernel renders
 * (JSON.stringify drops the request/when/effect functions → structure-only) are
 * what the UI dispatches via runFlow. One source — the diagram cannot drift from
 * the behaviour. The UI passes the POST/PUT body + :id in ctx.state and supplies
 * the success/error side-effects via ctx.ui. Logo upload (create/edit) is a
 * UI-form-state orchestration that stays in the UI effect closure; these flows
 * drive the primary commit + post-commit branch.
 */
export const createFlow: ExecFlow = {
  id: "accounts.create.exec",
  title: "Create Account",
  nodes: [
    {
      id: "submit",
      kind: "trigger",
      label: "Create Account",
      out: [{ id: "o", to: "commit" }],
    },
    {
      id: "commit",
      kind: "commit",
      label: "Create account",
      detail: "POST /api/financial-accounts",
      request: (ctx: FlowContext) => ({
        url: "/api/financial-accounts",
        method: "POST",
        body: ctx.state.body,
      }),
      out: [{ id: "o", to: "ok" }],
    },
    {
      id: "ok",
      kind: "condition",
      label: "Created?",
      when: (ctx: FlowContext) => (ctx.state.commit ? "yes" : "no"),
      out: [
        { id: "yes", to: "done", label: "yes" },
        { id: "no", to: "fail", label: "no" },
      ],
    },
    {
      id: "done",
      kind: "effect",
      label: "Close modal + refresh list (logo upload + recovery in UI)",
      effect: "refresh",
      out: [{ id: "o", to: "end" }],
    },
    {
      id: "fail",
      kind: "effect",
      label: "Show error (dup name / invalid)",
      effect: "toast",
      out: [{ id: "o", to: "end" }],
    },
    { id: "end", kind: "terminal", label: "Account created" },
  ],
};

export const updateFlow: ExecFlow = {
  id: "accounts.edit.exec",
  title: "Update Account",
  nodes: [
    {
      id: "save",
      kind: "trigger",
      label: "Save Changes",
      out: [{ id: "o", to: "commit" }],
    },
    {
      id: "commit",
      kind: "commit",
      label: "Update account",
      detail: "PUT /api/financial-accounts/:id",
      request: (ctx: FlowContext) => ({
        url: `/api/financial-accounts/${ctx.state.id}`,
        method: "PUT",
        body: ctx.state.body,
      }),
      out: [{ id: "o", to: "ok" }],
    },
    {
      id: "ok",
      kind: "condition",
      label: "Updated?",
      when: (ctx: FlowContext) => (ctx.state.commit ? "yes" : "no"),
      out: [
        { id: "yes", to: "done", label: "yes" },
        { id: "no", to: "fail", label: "no" },
      ],
    },
    {
      id: "done",
      kind: "effect",
      label: "Update detail + refresh list (logo op + exit-edit in UI)",
      effect: "refresh",
      out: [{ id: "o", to: "end" }],
    },
    {
      id: "fail",
      kind: "effect",
      label: "Show error (dup name / invalid)",
      effect: "toast",
      out: [{ id: "o", to: "end" }],
    },
    { id: "end", kind: "terminal", label: "Account saved" },
  ],
};

export const renameFlow: ExecFlow = {
  id: "accounts.rename.exec",
  title: "Rename Account",
  nodes: [
    {
      id: "submit",
      kind: "trigger",
      label: "Rename",
      out: [{ id: "o", to: "commit" }],
    },
    {
      id: "commit",
      kind: "commit",
      label: "Rename account",
      detail: "PUT /api/financial-accounts/:id (name only)",
      request: (ctx: FlowContext) => ({
        url: `/api/financial-accounts/${ctx.state.id}`,
        method: "PUT",
        body: ctx.state.body,
      }),
      out: [{ id: "o", to: "ok" }],
    },
    {
      id: "ok",
      kind: "condition",
      label: "Renamed? (no dup 409)",
      when: (ctx: FlowContext) => (ctx.state.commit ? "yes" : "no"),
      out: [
        { id: "yes", to: "done", label: "yes" },
        { id: "no", to: "fail", label: "no" },
      ],
    },
    {
      id: "done",
      kind: "effect",
      label: "Sync detail + close + refresh list",
      effect: "refresh",
      out: [{ id: "o", to: "end" }],
    },
    {
      id: "fail",
      kind: "effect",
      label: "Show error (duplicate name)",
      effect: "toast",
      out: [{ id: "o", to: "end" }],
    },
    { id: "end", kind: "terminal", label: "Renamed" },
  ],
};

export const archiveFlow: ExecFlow = {
  id: "accounts.archive.exec",
  title: "Archive Account",
  nodes: [
    {
      id: "yes",
      kind: "trigger",
      label: "Confirm Archive",
      out: [{ id: "o", to: "commit" }],
    },
    {
      id: "commit",
      kind: "commit",
      label: "Soft-delete account",
      detail: "DELETE /api/financial-accounts/:id",
      request: (ctx: FlowContext) => ({
        url: `/api/financial-accounts/${ctx.state.id}`,
        method: "DELETE",
      }),
      out: [{ id: "o", to: "ok" }],
    },
    {
      id: "ok",
      kind: "condition",
      // DELETE returns 204 (empty body) — branch on the ok-signal, not the body.
      label: "Deleted ok?",
      when: (ctx: FlowContext) => (ctx.state.commit__ok ? "yes" : "no"),
      out: [
        { id: "yes", to: "done", label: "yes" },
        { id: "no", to: "end", label: "no (leave open)" },
      ],
    },
    {
      id: "done",
      kind: "effect",
      label: "Close confirm + clear detail + refresh list",
      effect: "refresh",
      out: [{ id: "o", to: "end" }],
    },
    { id: "end", kind: "terminal", label: "Archived" },
  ],
};

export const restoreFlow: ExecFlow = {
  id: "accounts.restore.exec",
  title: "Restore Account",
  nodes: [
    {
      id: "restore",
      kind: "trigger",
      label: "Restore",
      out: [{ id: "o", to: "commit" }],
    },
    {
      id: "commit",
      kind: "commit",
      label: "Restore account",
      detail: "PATCH /api/financial-accounts/:id/restore",
      request: (ctx: FlowContext) => ({
        url: `/api/financial-accounts/${ctx.state.id}/restore`,
        method: "PATCH",
      }),
      out: [{ id: "o", to: "ok" }],
    },
    {
      id: "ok",
      kind: "condition",
      label: "Restored ok?",
      when: (ctx: FlowContext) => (ctx.state.commit ? "yes" : "no"),
      out: [
        { id: "yes", to: "done", label: "yes" },
        { id: "no", to: "end", label: "no" },
      ],
    },
    {
      id: "done",
      kind: "effect",
      label: "Update detail + refresh list",
      effect: "refresh",
      out: [{ id: "o", to: "end" }],
    },
    { id: "end", kind: "terminal", label: "Restored" },
  ],
};

export const flows: FlowDefinition[] = [
  buildFlow("accounts.board", "Accounts Board", (f) => {
    const n_list = f.data(
      "Accounts list",
      "GET /api/financial-accounts (page, limit, search, sortBy, sortDir, status)"
    );
    const n_enrich = f.call(
      "transactions.getAccountBalances (null when transactions off)",
      "Fetch balances"
    );
    const n_bal_present = f.condition("Transactions loaded?");
    const n_render_dash = f.effect("Show balance as '—'");
    const n_bal_type = f.condition("type === capital?");
    const n_capital_fig = f.compute("Outstanding vs overpaid");
    const n_render = f.effect("Show rows with balance + status badge");
    const n_search = f.trigger("Search by name/description");
    const n_filter = f.trigger("Active / Archived / All tab");
    const n_refetch = f.load(
      "Reload list",
      "GET /api/financial-accounts (new params)"
    );
    const n_row_name = f.trigger("Click account name");
    const n_goto_detail = f.effect("Open detail flow");
    const n_admin_gate = f.condition("Has create/edit/delete perm?");
    const n_admin_actions = f.data("Add Account btn + per-row actions menu");
    const n_add_account = f.trigger("+ Add Account");
    const n_goto_create = f.effect("Open create flow");
    const n_menu_open = f.trigger("Menu: Open");
    const n_menu_rename = f.trigger("Menu: Rename");
    const n_goto_rename = f.effect("Open rename flow");
    const n_menu_archive = f.trigger("Menu: Archive (when active)");
    const n_goto_archive = f.effect("Open archive flow");
    const n_menu_restore = f.trigger("Menu: Restore (when archived)");
    const n_goto_restore = f.effect("Open restore flow");
    const n_share = f.trigger("Share button");
    const n_share_modal = f.modal("Share link / permissions overlay");
    const n_end = f.terminal("Board ready");
    n_list.to(n_enrich);
    n_list.to(n_search);
    n_list.to(n_filter);
    n_list.to(n_row_name);
    n_list.to(n_admin_gate);
    n_enrich.to(n_bal_present);
    n_bal_present.to(n_bal_type, "yes");
    n_bal_present.to(n_render_dash, "no");
    n_render_dash.to(n_end);
    n_bal_type.to(n_capital_fig, "capital");
    n_bal_type.to(n_render, "normal");
    n_capital_fig.to(n_render);
    n_render.to(n_end);
    n_search.to(n_refetch);
    n_filter.to(n_refetch);
    n_refetch.to(n_enrich);
    n_row_name.to(n_goto_detail);
    n_goto_detail.to(n_end);
    n_admin_gate.to(n_admin_actions, "yes");
    n_admin_gate.to(n_end, "no");
    n_admin_actions.to(n_add_account);
    n_admin_actions.to(n_menu_open);
    n_admin_actions.to(n_menu_rename);
    n_admin_actions.to(n_menu_archive);
    n_admin_actions.to(n_menu_restore);
    n_add_account.to(n_goto_create);
    n_goto_create.to(n_end);
    n_menu_open.to(n_goto_detail);
    n_menu_rename.to(n_goto_rename);
    n_goto_rename.to(n_end);
    n_menu_archive.to(n_goto_archive);
    n_goto_archive.to(n_end);
    n_menu_restore.to(n_goto_restore);
    n_goto_restore.to(n_end);
    n_share.to(n_share_modal);
    n_share_modal.to(n_end);
  }),
  buildFlow("accounts.create", "Add Account", (f) => {
    const n_add_btn = f.trigger("+ Add Account");
    const n_modal = f.modal("New Account form");
    const n_pick_logo = f.trigger("Pick / paste logo (optional)");
    const n_crop = f.effect("Crop to 1:1 webp (deferred blob)");
    const n_submit = f.trigger("Create Account");
    const n_name_check = f.condition("Name provided?");
    const n_name_err = f.effect("Show 'Name is required'");
    const n_create = f.commit(
      "Create account",
      "POST /api/financial-accounts {name,type,description,icon,color}"
    );
    const n_create_ok = f.condition("Created? (no 409 dup / 400)");
    const n_create_fail = f.effect(
      "Show error (dup name / invalid type-icon-color)"
    );
    const n_has_logo = f.condition("Logo blob pending?");
    const n_upload_logo = f.commit(
      "Upload logo",
      "POST /api/financial-accounts/:id/logo (multipart)"
    );
    const n_logo_ok = f.condition("Logo saved?");
    const n_logo_recover = f.effect(
      "Reopen account in edit mode with logo error"
    );
    const n_close = f.effect("Close modal + refresh list");
    const n_end = f.terminal("Account created");
    n_add_btn.to(n_modal);
    n_modal.to(n_pick_logo);
    n_pick_logo.to(n_crop);
    n_crop.to(n_submit);
    n_submit.to(n_name_check);
    n_name_check.to(n_create, "yes");
    n_name_check.to(n_name_err, "no");
    n_name_err.to(n_modal);
    n_create.to(n_create_ok);
    n_create_ok.to(n_has_logo, "yes");
    n_create_ok.to(n_create_fail, "no");
    n_create_fail.to(n_modal);
    n_has_logo.to(n_upload_logo, "yes");
    n_has_logo.to(n_close, "no");
    n_upload_logo.to(n_logo_ok);
    n_logo_ok.to(n_close, "yes");
    n_logo_ok.to(n_logo_recover, "no");
    n_logo_recover.to(n_end);
    n_close.to(n_end);
  }),
  buildFlow("accounts.view", "View Account Detail", (f) => {
    const n_open = f.trigger("Open account (name click / menu Open)");
    const n_load = f.load(
      "Load account",
      "GET /api/financial-accounts/:id (balance-enriched)"
    );
    const n_modal = f.modal("Detail modal");
    const n_presign = f.load(
      "Resolve logo URL",
      "GET /api/financial-accounts/:id/logo/presign"
    );
    const n_presign_ok = f.condition("Presigned URL ok & https?");
    const n_fallback = f.effect("Fall back to public s3_link");
    const n_show = f.effect("Show name, type, balance, logo");
    const n_edit_trig = f.trigger("Edit (pencil, if admin)");
    const n_goto_edit = f.effect("Open edit flow");
    const n_archive_trig = f.trigger("Archive (if active & admin)");
    const n_goto_archive = f.effect("Open archive flow");
    const n_restore_trig = f.trigger("Restore (if archived & admin)");
    const n_goto_restore = f.effect("Open restore flow");
    const n_end = f.terminal("Detail shown");
    n_open.to(n_load);
    n_load.to(n_modal);
    n_modal.to(n_presign);
    n_modal.to(n_edit_trig);
    n_modal.to(n_archive_trig);
    n_modal.to(n_restore_trig);
    n_presign.to(n_presign_ok);
    n_presign_ok.to(n_show, "yes");
    n_presign_ok.to(n_fallback, "no");
    n_fallback.to(n_show);
    n_show.to(n_end);
    n_edit_trig.to(n_goto_edit);
    n_goto_edit.to(n_end);
    n_archive_trig.to(n_goto_archive);
    n_goto_archive.to(n_end);
    n_restore_trig.to(n_goto_restore);
    n_goto_restore.to(n_end);
  }),
  buildFlow("accounts.edit", "Edit Account", (f) => {
    const n_edit_btn = f.trigger("Edit (pencil) in detail modal");
    const n_form = f.modal("Edit Account form (prefilled)");
    const n_logo_change = f.trigger("Replace / remove logo (optional)");
    const n_save = f.trigger("Save Changes");
    const n_name_check = f.condition("Name provided?");
    const n_name_err = f.effect("Show 'Name is required'");
    const n_update = f.commit(
      "Update account",
      "PUT /api/financial-accounts/:id"
    );
    const n_update_ok = f.condition("Updated? (no error)");
    const n_update_fail = f.effect("Show error (dup name / invalid)");
    const n_new_blob = f.condition("New logo blob picked?");
    const n_upload_logo = f.commit(
      "Upload logo",
      "POST /api/financial-accounts/:id/logo"
    );
    const n_clear_check = f.condition("Marked clear & had logo?");
    const n_clear_logo = f.commit(
      "Remove logo",
      "DELETE /api/financial-accounts/:id/logo"
    );
    const n_logo_ok = f.condition("Logo op ok?");
    const n_logo_fail = f.effect("Keep edit open, show logo error");
    const n_done = f.effect("Update detail + refresh list, exit edit");
    const n_end = f.terminal("Account saved");
    n_edit_btn.to(n_form);
    n_form.to(n_logo_change);
    n_logo_change.to(n_save);
    n_save.to(n_name_check);
    n_name_check.to(n_update, "yes");
    n_name_check.to(n_name_err, "no");
    n_name_err.to(n_form);
    n_update.to(n_update_ok);
    n_update_ok.to(n_new_blob, "yes");
    n_update_ok.to(n_update_fail, "no");
    n_update_fail.to(n_form);
    n_new_blob.to(n_upload_logo, "yes");
    n_new_blob.to(n_clear_check, "no");
    n_upload_logo.to(n_logo_ok);
    n_clear_check.to(n_clear_logo, "yes");
    n_clear_check.to(n_done, "no");
    n_clear_logo.to(n_logo_ok);
    n_logo_ok.to(n_done, "yes");
    n_logo_ok.to(n_logo_fail, "no");
    n_logo_fail.to(n_form);
    n_done.to(n_end);
  }),
  buildFlow("accounts.rename", "Rename Account", (f) => {
    const n_rename_btn = f.trigger("Rename (row menu)");
    const n_modal = f.modal("Rename modal");
    const n_submit = f.trigger("Rename");
    const n_empty_check = f.condition("Name non-empty?");
    const n_name_err = f.effect("Show 'Name is required'");
    const n_changed_check = f.condition("Name changed from current?");
    const n_close_noop = f.effect("Close modal silently (no write)");
    const n_commit = f.commit(
      "Rename account",
      "PUT /api/financial-accounts/:id (name only)"
    );
    const n_commit_ok = f.condition("Renamed? (no dup 409)");
    const n_err = f.effect("Show error (duplicate name)");
    const n_done = f.effect("Sync detail + close + refresh list");
    const n_end = f.terminal("Renamed");
    n_rename_btn.to(n_modal);
    n_modal.to(n_submit);
    n_submit.to(n_empty_check);
    n_empty_check.to(n_changed_check, "yes");
    n_empty_check.to(n_name_err, "no");
    n_name_err.to(n_modal);
    n_changed_check.to(n_commit, "yes");
    n_changed_check.to(n_close_noop, "no");
    n_close_noop.to(n_end);
    n_commit.to(n_commit_ok);
    n_commit_ok.to(n_done, "yes");
    n_commit_ok.to(n_err, "no");
    n_err.to(n_modal);
    n_done.to(n_end);
  }),
  buildFlow("accounts.archive", "Archive Account", (f) => {
    const n_archive_btn = f.trigger("Archive (row menu / detail)");
    const n_confirm = f.modal("Archive confirmation (danger)");
    const n_yes = f.trigger("Confirm Archive");
    const n_commit = f.commit(
      "Soft-delete account",
      "DELETE /api/financial-accounts/:id (is_active=false)"
    );
    const n_commit_ok = f.condition("Deleted ok?");
    const n_noop = f.effect("Leave modal open (no change)");
    const n_done = f.effect("Close confirm + clear detail + refresh list");
    const n_end = f.terminal("Archived");
    n_archive_btn.to(n_confirm);
    n_confirm.to(n_yes);
    n_yes.to(n_commit);
    n_commit.to(n_commit_ok);
    n_commit_ok.to(n_done, "yes");
    n_commit_ok.to(n_noop, "no");
    n_noop.to(n_end);
    n_done.to(n_end);
  }),
  buildFlow("accounts.restore", "Restore Account", (f) => {
    const n_restore_btn = f.trigger("Restore (row menu / detail, archived)");
    const n_commit = f.commit(
      "Restore account",
      "PATCH /api/financial-accounts/:id/restore (is_active=true, gated on .edit)"
    );
    const n_commit_ok = f.condition("Restored ok?");
    const n_noop = f.effect("No change");
    const n_done = f.effect("Update detail + refresh list");
    const n_end = f.terminal("Restored");
    n_restore_btn.to(n_commit);
    n_commit.to(n_commit_ok);
    n_commit_ok.to(n_done, "yes");
    n_commit_ok.to(n_noop, "no");
    n_noop.to(n_end);
    n_done.to(n_end);
  }),
];
