# kplugin_transactions

A ksERP plugin for **the general ledger — every income and expense recorded**.

The bookkeeping core: every **transaction** (income, expense, transfer between accounts) lives here. The counter records sales as transactions; staff enter expenses manually; financial reports read from this table. Counter and any future financial-report plugin read transactions through a typed extension point — never raw cross-schema SQL.

## What it does

- **Record income / expense / transfer.** Each transaction has a date, amount, debit + credit account (from financial-accounts), optional payee (from payees), category, and notes.
- **Line items.** A single transaction can have multiple line items (e.g. an invoice with three services on it), each posting to its own account.
- **Per-row privacy.** Rows can be marked private — only the creator, explicitly-shared users, shared roles, and admin/superuser can read them. Enforced in the plugin's own `privacyClause()` SQL fragment off the kernel-forwarded identity.
- **Backdate + audit.** Backdating an entry is allowed when the user holds `transactions.backdate`; audit-only roles see everything via the role permission set, also enforced inside the plugin.
- **Search + filter + export.** Date-range, account, payee, amount range; results streamable as CSV.

## Where it lives in the app

| Surface | Value |
| --- | --- |
| Route prefix | `/api/transactions` |
| UI route | `/transactions` (under **Bookkeeping** in the sidebar) |
| Database schema | `accounts` (shared with `financial-accounts`; this plugin owns the `transactions`, `transaction_line_items`, `transaction_subcategories`, `transaction_attachments`, `transaction_visibility`, `transaction_visibility_role`, `transaction_payments`, `transaction_edits`, `transaction_customer_groups`, and `transaction_customers` tables — the `accounts.financial_accounts` table itself belongs to financial-accounts) |
| Process port | `4020` (loopback only) |
| Permissions | `transactions.view`, `transactions.create`, `transactions.edit`, `transactions.delete`, `transactions.backdate` |



## How to start it (for developers)

The plugin is a standalone Node process. The ksERP kernel reads this plugin's
`plugin.manifest.json`, starts the process for you in dev, and reverse-proxies
HTTP traffic to it. You don't run the plugin directly — you run the kernel
and it spawns the plugin.

### Steps

**1. Get the kernel checked out next to this plugin.**

```bash
cd ..   # if you're inside kplugin_transactions/
git clone git@github.com:llupRisinglll/kserp.git
cd kserp
npm ci
npm run build:packages
```

The plugin imports a few things from the kernel (`@ks-erp/kernel/...`).
`build:packages` makes that import resolve.

**2. Share the kernel's `node_modules` with the plugin.**

```bash
ln -s ../kserp/node_modules ../kplugin_transactions/node_modules
```

Rather than installing every dep (`express`, `pg`, `tsx`, the kernel package)
twice, the plugin uses the kernel's. The deploy script does the same.

**3. Start the kernel and point it at the plugin.**

```bash
cd ../kserp
KSERP_PLUGINS=../kplugin_transactions npm run dev
```

`KSERP_PLUGINS` is a comma- or path-separated list of plugin directories.
List more than one to load multiple plugins at the same time.

**4. Watch the logs.**

You should see:

- `[plugin-loader] registered "transactions@..."` — kernel read the manifest.
- `[plugin-proxy] spawned "transactions" ...` — kernel started the process.
- `[transactions] standalone server on http://127.0.0.1:4020` — plugin migrated
  its tables and is listening.
- `[plugin-proxy] /api/transactions -> 127.0.0.1:4020 (transactions)` — kernel proxy
  is mapping HTTP traffic.

Now hitting `/api/transactions` through the kernel reaches the plugin.

## The architecture rule it follows

> A plugin's features disappear when the plugin is removed. The kernel must
> never hardcode a plugin's concepts.

This plugin owns its tables (``accounts``), its routes (`/api/transactions`), its
permissions, and its capability (`transactions`). The kernel learns about
all of those from `plugin.manifest.json` at boot time — no kernel file
references this plugin by name. Other plugins that need this plugin's data
go through a typed extension point or the kernel's links runner, never raw
cross-schema SQL.

If you ever find yourself adding this plugin's name or a value it owns to
kernel code, stop and add an extension mechanism the plugin contributes to
instead.

## Releasing changes

This repo uses [Changesets](https://github.com/changesets/changesets) for
versioning.

1. Make your changes on a feature branch off `staging`.
2. Run `npx changeset` and pick a bump (patch / minor / major) — it creates
   a small markdown file in `.changeset/` describing what changed.
3. Commit the changeset file alongside your code change. Open a PR to
   `staging`.
4. When `staging` is merged into `main`, the `Release` workflow:
   - bumps the version in `package.json` according to the pending
     changesets;
   - rewrites `CHANGELOG.md`;
   - commits + tags as `chore(release): vX.Y.Z`;
   - pushes the tag and the bump back to `main`;
   - force-syncs `staging` to match `main` so the next feature starts from
     the released state.
