# @kahitsan/kplugin_transactions

## 1.8.1

### Patch Changes

- 0af54cb: The counter board now serves through the availment projection even when the client omits the `limit` parameter, so older counter builds stay fast instead of falling back to the legacy recursive query.

## 1.8.0

### Minor Changes

- 9962086: Counter board reads now use a precomputed availment projection, replacing the slow recursive chain query with bounded, indexed lookups. Singleton availments and mixed cards with voided package groups render correctly, and the board refreshes only after the projection has caught up with the write.

## 1.7.1

### Patch Changes

- 2317d4a: Bump @kahitsan/ksui to 0.37.1 for the popover/modal top-layer fix.
- 6c725f8: Deleting a payment or attachment no longer reports failure when it actually succeeded.

## 1.7.0

### Minor Changes

- a19e8d8: Add configurable financial-account payment defaults and manual sort order for account lists and payment pickers.

## 1.6.1

### Patch Changes

- 941f110: Fix `GET /api/transaction-line-items` silently dropping a today-dated line item when it shares a transaction and client with other bookings. The combined-stay aggregation groups non-voided time-bound lines into a chain per transaction + client (package_id not part of the key) and combines a run whenever it is continuously occupied — a chain breaks only on a real gap against the running maximum end seen so far, not just the immediately preceding line. This fixes both a false break from a shorter line nested inside a longer still-covering one, and a false break caused by a sibling with a NULL `ends_at`, either of which could previously split a genuinely continuous stay and bucket part of it into the past.

## 1.6.0

### Minor Changes

- 922349a: Support changing or removing a customer group's voucher during a cart edit (`voucher_changes` on `PATCH` cart-edit), and fix the group's discount not resetting to zero when its voucher is removed mid-edit. Transaction detail now resolves each customer group's voucher into the full code/type/value/limits shape instead of a bare id, with the same resolution mirrored onto the top-level transaction for legacy single-customer transactions that have no customer-group rows.

## 1.5.1

### Patch Changes

- 1ad85f7: Fix the transactions list showing the original package name after a cart-edit swap. The row summary now reflects the currently active line items instead of the stale description saved at checkout, and a package added during the edit is now labeled "Package — Variant" instead of just the variant name.

  Fix the same staleness in the transaction detail modal's title and its edit form: a cart-edit swap now regenerates the transaction's stored description from the currently active line items, so both surfaces stay in sync with the list. The detail route now also derives its description live from the currently active lines (same as the list route), so transactions edited before this fix show the correct title immediately, with no need to re-edit them.

  Fix voided line items showing up as "Packages availed" in the transaction detail view and in the transaction edit form — voided lines are now excluded everywhere a transaction's line items are read for display.

  Fix the list row title and the detail modal title disagreeing with the "Packages availed" pane on a line written before the description-format fix: a bare description like "4 Hours" made the title read "1× 4 Hours" while the pane, which resolves the package name separately, showed "Inner Area · 4 Hours". Both now resolve the package name from the same place, so a bare description gets the package name prepended ("Package — description") and an already-prefixed charge-format description is left untouched instead of doubled.

## 1.5.0

### Minor Changes

- c4d151a: apply-cart-edit accepts a `{ started_at }` addition anchor (a new package for
  an existing customer now anchors at that customer's original session start
  instead of "now") and an optional `reassign_payer_to` field, with an atomic
  is_payer flip + transactions.client_id resync and a 409
  `PAYER_REASSIGNMENT_REQUIRED` guard when a save would otherwise strand
  billing attribution on a zero-active-line group. customer-group-started-at
  now accepts `customer_group_id: null` for legacy/synthetic transactions,
  matching the client's documented intent.

## 1.4.0

### Minor Changes

- 3de0e54: Add POST /api/transactions/:id/apply-cart-edit for POS edit-cart — cashiers can now Save reductions (voiding or reducing original items) AND additions (new items on the existing customer group or a brand-new one, e.g. "a friend joined and grabbed a package too") on the SAME receipt in one atomic call, instead of spawning a separate child transaction. Every added item is priced and named server-side from the picked package variant — the cashier only picks a variant and a quantity; the price, description, and duration always come from the packages plugin, never the client. The recorded payment is preserved throughout and the balance is netted against the new total. The endpoint runs inside a single DB transaction with a FOR UPDATE lock, replays idempotently via edit_token, computes the line diff server-side, and writes transaction_edits audit rows. Guards against an empty resulting cart (EMPTY_CART) and against editing a transaction with a refund on it (REFUND_BLOCKED, refunds are intentionally out of scope). The same parent-lifecycle guard (voided/forfeited parent) now also covers line-item void, extend, and charge-overage.

## 1.3.4

### Patch Changes

- 4e6cd58: Bump @kahitsan/ksui to ^0.36.1 (fix: ProgressBar/LiveTimer amber fill restored via explicit color prop).

## 1.3.3

### Patch Changes

- c44f1fd: Rescheduling a settled booking into the future now reopens it (status back to active), and a reschedule that matches no booking now fails loudly with a 404 instead of silently succeeding.

## 1.3.2

### Patch Changes

- aee0fc4: Perf: `computeAccountBalances` (the read backing `GET /api/financial-accounts`) rewrites its `legacy_sums` CTE from a correlated `NOT EXISTS` re-check plus an unindexable `(source_account_id = $id OR destination_account_id = $id)` join into a set-based `UNION ALL` of the destination leg and the source leg, each filtered on its own single-column index (`idx_transactions_dest` / `idx_transactions_source`, ported into this plugin's own migrations in the same change — they previously existed on prod only via pre-fork monolith history), with the "already paid" set precomputed once via a hash anti-join (`paid_txn_ids`) instead of per-row. Reconciled byte-identical against the prior formula across every account in a 300k-row synthetic fixture (split payment legs, forfeits, transfers, self-transfers, voided/unpaid sales) — see `tests/integration/account-balances.reconcile.test.ts`. Measured on that fixture: the query plan for a 4-account read moved from a `Nested Loop` materializing the OR-join once per requested account (1234ms) to index-backed `Bitmap Heap Scan`s per leg (688ms), and eliminates the Materialize/temp-file spill the OR-join forced under the correlated-subplan formula this supersedes the deferred "materialized running balance" note left in an earlier changeset.

## 1.3.1

### Patch Changes

- 294a332: Security hardening: reject a charge whose `destination_account_id` belongs to another workspace, repoint the stale `export_jobs`/`transaction_amount_paid` RLS policies onto `auth.workspace_id()`, validate every `:id`/`:paymentId`/`:attachmentId`/`:lineItemId` path param before it reaches SQL, replace every `RETURNING *`/`SELECT *`/`t.*` on `accounts.transactions`/`accounts.transaction_line_items` (including the list and detail routes' `SELECT t.*`) with explicit column lists, and cap client-supplied money amounts at the `NUMERIC(12,2)` ceiling so an oversized value returns a clean 400 instead of a raw Postgres error.

  Closes the same cross-tenant gap on the routes the charge fix didn't cover: the manual transaction create/edit routes and the `createSalaryTransaction` cross-plugin RPC now assert `source_account_id`/`destination_account_id` ownership before persisting, and the payment-leg routes (add/edit) now assert `financial_account_id` ownership and enforce the `NUMERIC(12,2)` amount ceiling. The `:id` path-param parsing duplicated across `attachments.ts`/`payments.ts` is consolidated into one `parseIntParam` helper.

  Also caps `transfer_fee_amount` on the manual transfer create/edit routes at the same `NUMERIC(12,2)` ceiling — previously only the sibling `amount` field was capped, so an oversized fee reached the fee-row insert/update and raised a raw Postgres 500 instead of a clean 400.

  Performance: drops the redundant `fa_org_isolation`/`tp_org_isolation` RLS policies on `accounts.financial_accounts`/`accounts.transaction_payments` (confirmed byte-identical to the surviving canonical policy — halves the per-row predicate-eval cost, no isolation change) and adds `idx_transactions_ws_status_amount (workspace_id, status, amount DESC, id DESC)` so `GET /api/transactions?sortBy=amount&status=<value>` can walk an index instead of a parallel seq scan + external-merge sort. `GET /api/financial-accounts`'s balance computation was assessed — its join/filter columns are already indexed, so no new index would move the plan; the remaining cost needs a materialized running balance and is left as a deferred architectural note in `account-balances.ts`.

  Follow-up correction: `idx_transactions_ws_status_amount` only serves the equality-status shape — an inequality on its 2nd column can't be walked as an index range, so the route's DEFAULT/most-common shape (no `?status`, i.e. `status <> 'voided'`) still fell back to the Seq Scan + top-N sort the index was meant to fix. Adds a partial index, `idx_transactions_ws_amount_active (workspace_id, amount DESC, id DESC) WHERE status <> 'voided'`, matching that default filter directly. Verified live against a seeded 838k-row replica (RLS active, `app_authenticated`): the route's exact default-sort query for `workspace_id = 3` went from a Seq Scan + top-N heapsort (5458.6 ms execution, cold cache) to an `Index Scan` on the new partial index with no sort node (0.997 ms execution, warm cache) — same result set, both indexes now coexist to serve their respective call shapes.

  Second follow-up correction: `accounts.transaction_customers` carries a third RLS accretion the prior pass missed — THREE policies (`transaction_clients_org_isolation`, `transaction_customer_groups_org_isolation`, `transaction_customers_org_isolation`) with byte-identical `cmd=ALL` USING/WITH CHECK expressions (`auth.is_superuser() OR workspace_id = auth.workspace_id()`), left over from the table's rename history (`transaction_clients` -> `transaction_customer_groups` -> `transaction_customers`). Drops the two stale short-named policies, leaving the canonical `transaction_customers_org_isolation` policy enforcing the exact same predicate — one less redundant permissive-policy eval per row, no isolation change. Verified live: applied on the worktree DB, confirmed exactly 1 policy remains via `pg_policy`, and confirmed workspace isolation still holds (`app_authenticated` scoped to a non-owning workspace sees 0 of the table's 7793 rows; scoped to the owning workspace sees all 7793).

## 1.3.0

### Minor Changes

- e71ea3f: Add a third Royal Violet variant, `high-contrast` (`appearance: "dark"`), per THEME-SPEC-V2.1-DYNAMIC-VARIANTS.md §7.2 — the addendum's own end-to-end proof that a theme's `variants` map works past the v2 two-key (`dark`/`light`) special case. Pure-black surfaces + pure-white text/borders push royal-violet's identity (violet primary, gold accent, lifted in luminance) to WCAG-AAA-adjacent contrast (body text ≥7:1, UI/accent pairs ≥4.5:1 — verified with a standalone relative-luminance script, values iterated until every pairing passed).

  `royal-violet` bumps `1.1.0` → `1.2.0`. Additive only — `variants.dark`/`variants.light` are byte-for-byte unchanged, so this ships no visual regression for existing users. **Sequenced after the kernel PR that lands the v2.1 loader** (open `variantId` map, `appearance` inference, `MAX_VARIANTS_PER_THEME`): the current kernel on this branch is still v2-only and its `isInvalidVariantsShape` check drops the _entire_ contributed theme when `variants` contains any key other than `dark`/`light`, so deploying this manifest change ahead of that kernel PR would silently pull Royal Violet from every workspace that has it selected, not just withhold the new variant. Do not deploy before the kernel PR is live.

- 5844993: Contribute the "Royal Violet" theme via `plugin.manifest.json`'s `contributes.themes` (THEME-SPEC.md §4.3) — the first real third-party-pipeline theme, proving a plugin can ship its own brand palette (violet primary/accent, `#7c3aed`–`#a78bfa`) without touching kernel code.

  This manifest change causes a kernel reload on deploy (its SHA changes) — kserp's tier-aware loader parses `contributes.themes` at plugin-load time and registers the entry namespaced as `finance:royal-violet`.

  Migrated to THEME-SPEC-V2-VARIANTS.md's shape (`v1.1.0`): the flat `base`/`tokens` fields are replaced by `variants.dark`/`variants.light`, and a new light-violet variant (`--ks-bg: #f7f3ff`, `--ks-primary: #6d28d9`) ships alongside the existing dark palette so Royal Violet renders correctly in both modes. Sequenced after the kernel PR that ships the v2 loader (§7 of the addendum) — deploy this only once that loader is live.

### Patch Changes

- cdf2dfe: Migrate UI to the theme token system (`--ks-*` via Tailwind v4 `@theme`), replacing hardcoded zinc/amber/red/emerald/blue palette classes and raw hex/rgb literals so the plugin renders correctly once the workspace theme resolves to something other than the built-in dark default.

## 1.2.0

### Minor Changes

- afd850e: Expose a `hasClientAvailedPackage` RPC service (batched by lineage's package ids + a before-date) so packages can evaluate its `client_availed_package_before` eligibility condition over the consent-gated gateway instead of querying `accounts.*` directly.

### Patch Changes

- 2e5e321: Open the financial-accounts detail modal instantly on click instead of waiting on the fetch — it now renders a skeleton (matching the transaction detail pattern) while the account loads, and ignores a stale response for an id the user has since closed or switched away from.
- 128829f: Remove the vestigial `version` field from `plugin.manifest.json`; `package.json` is the single version source of truth (the kernel already reads it for cache-busting and release tagging). Requires the paired kserp kernel change tolerating a manifest with no `version`.
- b8b28aa: `GET /api/transaction-line-items` now returns each row's effective voucher discount inputs (`transaction_subtotal`, `customer_group_subtotal`, `customer_group_voucher_id`, `customer_group_discount_amount`, `effective_voucher`) so the Counter Extend modal can preview the post-extend discounted total without drifting from the `/extend` route's own pricing.
- 2544908: Fix `POST /api/transaction-line-items/:id/extend` and `POST /api/transaction-line-items/:id/charge-overage` silently dropping the parent transaction's voucher discount: both now re-apply the attached voucher (transaction-level or per-customer-group) against the new subtotal instead of adding the raw cost increase to `amount` untouched.

## 1.1.0

### Minor Changes

- daa362b: Adopt the pages-map remote contract: the host now dispatches /transactions, /payees, /financial-accounts and /analytics from the exported `pages` map instead of an in-plugin Switch on routeBase, so an unmapped route fails loud instead of silently rendering the transactions page. Requires a kernel with the pages-map remote contract.

### Patch Changes

- c31f371: Declare the two peer service calls the code already makes (`service:findPackagesByIds@packages`, `service:validate@vouchers`) in the manifest `requires`, so they survive the kernel's fail-closed RPC gate.

## 1.0.3

### Patch Changes

- 95ce322: Move TransactionForm and its sub-components (AccountPicker, FormAdvancedSection, SalesBodyEditor, TransferFeeChip, TransferAccountsPicker) into `@kahitsan/ksui`, so the counter plugin's staff-dashboard expense entry can reuse the real form instead of a hand-forked copy. No behavior change on this plugin's own `/transactions` page -- same components, now imported from ksui.

## 1.0.2

### Patch Changes

- 01c8683: Refine the transaction recording form, move transfer fee entry next to the amount, render assigned account icons, classify transfer fee rows as other expense, and link the transfer to its fee expense so editing either one keeps them in sync (edit form pre-fills the fee, changes propagate on save, removing the fee deletes the linked row).

## 1.0.1

### Patch Changes

- c1e3b6b: chore: update pipeline + docs refs from `transactions` → `finance` after the July 2026 identity rename

  - `.github/workflows/deploy.yml` — `plugin-name` and `concurrency.group` now use `finance` (renames the prod `/opt/kserp/plugins/<name>` dir + the pm2 process to match the manifest identity)
  - `package.json` description refreshed
  - `README.md` code snippets use the current repo name

## 1.0.0

### Major Changes

- 29c8e75: feat: rename `transactions` → `finance` and fold `financial-accounts` in

  - Manifest identity renamed: `name`/`capabilityKey`/`label` → `finance`. `package.json` renamed to `@kahitsan/kplugin_finance`. The standalone `financial-accounts` plugin is retired in the same rollout — its `/api/financial-accounts` URL namespace is preserved via `additionalBasePaths`, so external API consumers keep working.
  - Adds a fourth UI route `financial-accounts` (nav label "Accounts", icon `wallet`) served from the same bundle.
  - Adopts `accounts.financial_accounts` in this plugin's migration tracker; every statement is idempotent so prod's existing rows are untouched.
  - Adds `financial_accounts.{view,create,edit,delete}` permissions to the manifest and mounts the folded-in accounts router.
  - Inlines the account-balance query (no more cross-plugin self-RPC round-trip through the kernel now that transactions + accounts live in the same process).
  - Exposes `service:findByIds` (accounts resource) so peers resolve account display names without importing this plugin's tables.

## 0.12.0

### Minor Changes

- dd3ef8e: Add `POST /:id/forfeit` to write off a sale's remaining balance (no-show / past refund window). Writes the transaction's `amount` down to what was actually collected, settles any still-active line items, and records an audit trail — already-collected payments are left untouched.

## 0.11.0

### Minor Changes

- 0394c9b: feat: fold the Finance Analytics dashboard into the transactions plugin
  (multi-route). One process/bundle now serves `/transactions`, `/payees` and the
  folded-in `/analytics`, dispatched from the manifest `routes[]` + the remote
  `Component` on `routeBase`. Analytics is UI-only — no schema, no server routes:
  its dashboard reads endpoints that already live in this plugin
  (`/api/transactions/summary`, `/cashflow`, `/api/transactions`) plus a
  kernel-proxied browser fetch to `/api/financial-accounts`. The §9 flow graph
  merges in via `server/flows-analytics.ts`. Adds the `analytics.view` permission
  and the Analytics `nav` (order 0) to the manifest. Retires the standalone
  `kplugin_analytics` (removed from the deploy roster in the same rollout).

## 0.10.1

### Patch Changes

- 2949ec4: fix: register GET /grouped-by-date route

  The "group sales per day" table view fetched `/api/transactions/grouped-by-date`, but no such route was registered — the request fell through to the `GET /:id` detail handler, which parsed the literal `"grouped-by-date"` as an integer id and errored with `invalid input syntax for type integer`. The UI degraded to an empty grouped view. Adds the documented sales-only per-day aggregate endpoint (registered ahead of `/:id`) returning `{ data: [{date, count, total, currency}], total }`, filtered identically to the list so the per-day counts match the day drilldown.

## 0.10.0

### Minor Changes

- 9700bc7: feat: fold payees into the transactions plugin (multi-route). One process now
  serves `/api/transactions` + `/api/payees` and contributes both a Transactions
  and a Payees nav entry via the manifest `routes[]`. The payees CRUD + `findByIds`
  run in-process (the former cross-plugin RPC to `kplugin_payees` is now a direct
  `public.payees` query); the `public.payees` table + RLS + grants are adopted via
  idempotent, schema-qualified migrations. Retires the standalone `kplugin_payees`
  (removed from the deploy roster in the same rollout).

## 0.9.13

### Patch Changes

- a3b5d97: Drop the eyebrow line from the page header (kernel's PageShell no longer renders it). Bump `@kahitsan/ksui` to 0.31.1.

## 0.9.12

### Patch Changes

- 43ecb1c: Add a workspace-scoped board-change signal: every successful write bumps a version that (a) feeds a new SSE endpoint `GET /api/transaction-line-items/events` so counter terminals refresh instantly on cross-terminal writes, and (b) invalidates a short-TTL in-process cache in front of `getPackageCapacityUsage`, absorbing repeated capacity polls between writes.
- e377029: Scope the counter-board payment CTEs to matched transactions instead of aggregating the whole workspace history (they were the dominant cost of the top query by total prod DB time), and replace the `/outstanding` per-row LATERAL payments sum with one grouped hash join. Response shapes verified byte-identical across param combos.

## 0.9.11

### Patch Changes

- 1aacd95: Bump @kahitsan/ksui to 0.31.0 for the fleet-wide compact DataTable + flat StatusPill redesign (no-skew dependency bump; no behavior change in this plugin).

## 0.9.10

### Patch Changes

- ca51fb2: Consume the shared @kahitsan/ksui `uploadPendingFiles` helper instead of the plugin's own local copy of the attachment-upload loop. No behavior change.

## 0.9.9

### Patch Changes

- b4ed682: Consolidate the duplicated superuser/workspace-admin bypass check (privacy + backdate gates) into a single import from `@kahitsan/plugin-sdk`'s new `isWorkspaceElevated` export, replacing 6 independent hand-rolled copies.

## 0.9.8

### Patch Changes

- dba80f2: Fix transactions CSV export progress stream under the Bun runtime. The
  `/export/:jobId/progress` SSE route used raw Node `res.write()`, which throws
  under Bun + Hono (`c.res` is a Fetch `Response`); rewritten to use Hono's
  `streamSSE`. Export now streams progress/done frames and completes.

## 0.9.7

### Patch Changes

- 69c5384: Decouple from the kserp source tree for OSS. The plugin-author surface now resolves via the published `@kahitsan/plugin-sdk` (bumped to `^0.5.1`) instead of `../kserp` tsconfig/vitest paths, and the unused `@ks-erp/kernel` peerDependency is removed. Where they were present, the S3 and test-harness imports are repointed to `@kahitsan/plugin-sdk` (+ `/test`) and the dead Express `Request` augmentation and `express` dependency are dropped (plugins are Hono).

## 0.9.6

### Patch Changes

- 32fcd6e: fix: payroll salary attachments + Manila transaction date

  - `createSalaryTransaction` no longer takes any attachment payload. It used to
    accept base64 files (forced through the kernel RPC's JSON body, broke on size);
    that path is removed. The timesheets Pay flow now uploads receipts directly via
    the standard multipart `POST /:id/attachments` S3 route after the salary is
    created, so the RPC only records the expense.
  - The list and detail queries used `SELECT t.*`, so the `date`-typed
    `transaction_date` serialized via `.toISOString()` to the previous UTC day
    (a Jul 1 payment showed as Jun 30). Both now override it with
    `to_char(t.transaction_date, 'YYYY-MM-DD')` — the intended calendar date.
  - The dead-blob-attachment migration guards on `file_path` existing before
    querying it, so it no longer crash-loops the plugin when the column is absent.

## 0.9.5

### Patch Changes

- 3d3687a: createSalaryTransaction RPC now accepts backdate_reason and attachment payloads (base64). TransactionForm and related UI components now import PendingFile from @kahitsan/ksui instead of defining it locally.

## 0.9.4

### Patch Changes

- e6a9058: Bump @kahitsan/plugin-sdk to 0.4.4

## 0.9.3

### Patch Changes

- 864cad3: Serve transaction attachments via the proxy/blob pattern instead of a presigned URL. The new ownership-scoped `GET /:id/attachments/:attachmentId/raw` route streams the private object's bytes (via s3GetObject) through the authed app route; the UI renders a same-origin `blob:`. No DigitalOcean origin or signed bearer URL ever reaches the browser, and auth/ownership is re-checked on every fetch. Replaces the `/presign` route + resolver, and reuses the ksui `ExistingAttachmentTile` (extended with a `rawHref` blob-source mode) instead of a local fork. Requires `@kahitsan/ksui` ^0.29.0.

## 0.9.2

### Patch Changes

- 2695cae: A1 retire for transaction attachments (financial documents — receipts/invoices). Uploads now go to the private bucket (acl: private) and are served only through a new ownership-scoped presigned-URL route (GET /:id/attachments/:aid/presign), using the kernel's now-native S3 presign; the UI fetches a short-lived presigned URL per attachment instead of the bare public s3_link. Closes a world-readable exposure of financial-document attachments. (Self-presign of the plugin's own object via s3PresignUrl — simpler than the kernel-ledger indirection; asset_id wiring deferred. Retiring existing objects' CDN-cached public copies is a follow-on Spaces CDN purge, as with FA.)

## 0.9.1

### Patch Changes

- aae5f41: Declare the plugin's §9 node-step flows (authored with the buildFlow DSL) and serve them at the public GET /\_\_meta/flows for the kernel to render in the settings → Connections tab. Requires @kahitsan/plugin-sdk with the buildFlow DSL + createPluginServer flows option.

## 0.9.0

### Minor Changes

- 30df607: Adopt plugin-platform v3.2: migrate routes onto the F3 data surface, bootstrap via `createPluginServer`, author against the single `@kahitsan/plugin-sdk`, consume `@kahitsan/ksui@0.21.0`, rename org→workspace. Declares the IP1 consent edge and exposes `transactions:read` in read-mode (U4 capacity) with a gate-4b smoke test. Drops the decommissioned Playwright e2e suite (CI gates on vitest).

## 0.8.1

### Patch Changes

- e0f9299: resolve sonarjs lint errors surfaced by the hardened plugin CI lint gate

## 0.8.0

### Minor Changes

- d2da7f3: Wire the transaction CSV export to S3/MinIO. Adds the job-based export routes (`POST /export`, SSE progress, authenticated streaming `download`, recent-jobs list): the CSV is generated in a background worker, uploaded as a **private** object, and streamed back through an authenticated route (a bulk financial export is never world-readable). Migrates the router to `requireWorkspace` (off the deprecated `requireOrg` alias) and the export modal to the `?wsId` workspace param.

## 0.7.1

### Patch Changes

- a47a6c3: Migrate UI component imports from @kahitsan/plugin-ui to @kahitsan/ksui.

## 0.7.0

### Minor Changes

- 8680657: Expose a `createSalaryTransaction` cross-plugin service that records a private "Salary - Direct" expense (director + accountant visibility, non-VAT) for the timesheets payroll flow; extract the shared transaction-insert helper so the service and the HTTP create route build the row identically. Also drop the vendored local `PayeePicker` in favour of the shared `@kahitsan/ksui` one.

## 0.6.18

### Patch Changes

- 53ab8d2: Dev-only build tooling: tag native UI elements with a repo-prefixed `data-source-loc="<repo>/<path>:<line>:<col>"` so DOM elements are attributable to their source repository across the multi-repo UI. Gated on `KSERP_DEV_SOURCE_ATTR=1`; CI/prod builds emit nothing (no runtime change).

## 0.6.17

### Patch Changes

- bf375da: Consume shared UI from @kahitsan/ksui (replaces @kahitsan/plugin-ui).

## 0.6.16

### Patch Changes

- 8ab54ec: Re-apply the workspace_id form of the accounts.\* RLS helper + tenant policies on
  production. Repairs `accounts.txn_org()` (it read the now-dropped
  `organization_id` column after the kernel Phase 3 migration) and re-points the
  six tenant policies from the kernel's `auth.org_id()` alias onto
  `auth.workspace_id()`, unblocking removal of that alias. Also drops the broad
  `transaction_edits_org_isolation` FOR ALL policy that the kernel hard-rename
  re-introduced, restoring the append-only audit hardening (SELECT + INSERT only).
  Logic-preserving; no-op on a fresh DB.

## 0.6.15

### Patch Changes

- c1f17cc: Phase 2 of the org→workspace rename: switch the plugin UI from the host's `useActiveOrg()` / `activeOrg()?.org_id` to `useActiveWorkspace()` / `activeWorkspace()?.ws_id`. The kernel keeps `organization_id` as a synced shadow until Phase 3, so this is safe.

## 0.6.14

### Patch Changes

- d96cb61: Refactored the transactions plugin: decomposed server routes into focused modules (transactions-core, transactions-counter-patch, transactions-detail, transactions-status) and the UI into focused components, hooks, and library modules. No behavior change.

## 0.6.13

### Patch Changes

- cc1ff15: Make the four category buttons (Expense, Sale, Payable, Transfer) in the transaction form render in a single row on all viewports instead of a 2x2 grid below the `sm:` breakpoint.

## 0.6.12

### Patch Changes

- 6a2bbf3: Fix concurrent capacity counting to include expired (unsettled) sessions and exclude sessions whose ends_at has passed. Add incoming reservation count to capacity-usage RPC.

## 0.6.11

### Patch Changes

- fe1828b: fix: account names now display correctly in the transactions list, detail view, and payment legs instead of showing dashes or raw IDs

## 0.6.10

### Patch Changes

- 285afe5: Internal refactor: split the oversized transactions routes.ts/helpers-charge.ts into focused handler/helper modules. No behavior change.

## 0.6.9

### Patch Changes

- 1561d07: Stop shipping local copies of the shared account + attachment widgets; consume the centralized @kahitsan/plugin-ui (AccountAvatar, account-icons, account-logo-url, accounts-index, attachments, ExistingAttachmentTile). No behavior change — the SDK ships the superset versions.

## 0.6.8

### Patch Changes

- 932251d: Enforce SonarJS recommended (at error) with `eslint .`; behavior-preserving cleanup of the remaining findings. The three god-file structure/complexity rules (no-nested-conditional, no-nested-functions, cognitive-complexity) are deferred to the #37 god-file split.

## 0.6.7

### Patch Changes

- 23c3bd3: Consume the shared UI components (MentionTextarea, MarkdownNotes, ClientPicker, VoucherPicker, CameraCapture, AddAttachmentTile) from `@kahitsan/plugin-ui` instead of local byte-identical copies. No behavior change; the built UI bundle is equivalent, with the components' Tailwind classes preserved via an explicit `@source`.
- 5777c50: Consume the shared s3 storage helper from `@kahitsan/plugin-server-utils` instead of a local byte-identical copy. No behavior change.

## 0.6.6

### Patch Changes

- 1602452: Activate row-level security: mount the kernel's withTenantContext middleware so every authenticated query runs under the org-scoped app_authenticated role, and scope each explicit transaction via applyTenantContext. Adds a migration granting app_authenticated the privileges it needs on the accounts schema.

  Also fixes a latent infinite-recursion in the transaction visibility RLS policies. The transactions policy referenced transaction_visibility and the visibility policies referenced transactions back, which only surfaced once RLS actually runs as a non-owner role (it was dormant under the owner connection). The visibility child tables now scope through a SECURITY DEFINER parent-org lookup that reads the parent without re-entering the policy stack, so RLS enforces org isolation while the application layer continues to enforce per-row visibility.

## 0.6.5

### Patch Changes

- d1c5dcb: Adopt the kernel plugin SDK for identity and auth, and harden the share-visibility update: clearing a transaction's per-user and per-role visibility now deletes those rows filtered by organization through the kernel's org-scoped database handle.
- cc27df9: Harden the cross-day edit-time e2e test against a Manila-midnight flake: when CI runs near 00:00 PHT, the test's `now - 28h` session straddles a day boundary and buckets ambiguously, so it now skips that assertion (matching the existing boundary-skip discipline) instead of failing. No runtime change.

## 0.6.4

### Patch Changes

- 55b0e25: fix: recompute ends_at when a customer-group started_at is edited

  The counter "edit time-in" action (PATCH /:id/customer-group-started-at) moved
  started_at without recomputing ends_at, leaving an inverted window
  (ends_at < started_at) that bucketed today's session onto yesterday's board.
  ends_at now tracks the edited start, and a data-repair migration heals rows
  already corrupted by the old behavior.

## 0.6.3

### Patch Changes

- 06dc2b2: Limit how many database connections each feature opens, preventing the system from exhausting the database under heavy load.

## 0.6.2

### Patch Changes

- 5f7244d: Replace the in-repo CI/Release/Deploy workflow logic with thin caller stubs of the reusable workflows in KahitSan/kplugin-workflows. No runtime behavior change; the patch bump exercises the new release + deploy path end to end.

## 0.6.1

### Patch Changes

- 92150b8: Internal cleanup of how transaction attachments are tracked now that they live entirely in cloud storage. No change to uploading, viewing, or deleting attachments.

## 0.6.0

### Minor Changes

- 87c18ae: Receipt and document attachments are now saved to secure cloud storage instead of the application server, so they load faster and stay safe even during server maintenance.

## 0.5.0

### Minor Changes

- 7c3b4ba: Add S3 storage link column to transaction attachments for cloud-based file storage

## 0.4.9

### Patch Changes

- 24d696b: Extensions on overdue counter rentals now chain correctly instead of appearing as duplicate entries on the board.

## 0.4.8

### Patch Changes

- 9d2f743: Fixed a regression where the transaction detail endpoint returned 500 errors after the display_name dynamic resolution was shipped without its client-name lookup variables.

## 0.4.7

### Patch Changes

- a268571: Counter can now change the assigned client in a group booking. Added three PATCH routes (client-pool, customer-group-started-at, customer-group-client) for editing customer groups without creating extensions. The payer's client change now syncs to the transaction level so the counter listing reflects the updated name.

## 0.4.6

### Patch Changes

- 6548cc7: Fixed upcoming line items appearing in the counter board when viewing past dates. The upcoming section previously used only `started_at > NOW()` without reference to the selected date, so future bookings were visible even on yesterday's scope.

## 0.4.5

### Patch Changes

- bbf86e2: Include customer_groups in transaction detail API response so the edit cart correctly renders multi-client bookings.

## 0.4.4

### Patch Changes

- 12f2157: Fix payee not being saved or displayed on transaction create/edit, and resolve "Last updated by" showing "Unknown"

## 0.4.3

### Patch Changes

- d5e8c9e: fix: add missing peer RPC imports so transaction detail and outstanding routes resolve package, variant, and client names without crashing

## 0.4.2

### Patch Changes

- a15ce3a: Fix file attachment upload failing with "file_name is required" error when pasting or selecting files.

## 0.4.1

### Patch Changes

- 277ba15: Restore cashflow endpoint for analytics plugin.

## 0.4.0

### Minor Changes

- 4cff9d2: Add PUT /:id/payments/:paymentId for updating payment amount and financial account. Harden attachment routes with explicit column lists and URL protocol validation.

## 0.3.1

### Patch Changes

- 9880bc6: Fixed batch booking editing in the counter: the transaction detail endpoint now returns customer group data so the editor can properly render each customer's row. Also fixed the client pool name field to match what the counter UI expects.

## 0.3.0

### Minor Changes

- 41662bc: The payment accounts behind each transaction are now surfaced to the counter, so booking cards can show how a customer paid — including when a payment was split across several accounts.

## 0.2.0

### Minor Changes

- d5049be: Powers the new Subscriptions page: lists each client's recurring plan (when it started, when it expires, how many renewals, lifetime value) and lets you renew a plan so the next billing window chains from where the current one ends.

## 0.1.8

### Patch Changes

- 35e5960: An attachment whose file is no longer available now shows a clear "Unavailable"
  placeholder instead of a broken image or dead link, and can still be removed.
- 35e5960: The transactions list and detail view now show the account, payee, and staff
  member for each entry again — including the account name on each payment. If the
  part of the app that owns one of those details is ever unavailable, a small
  warning icon appears in its place so it's clear the name couldn't load rather
  than showing a blank.

## 0.1.7

### Patch Changes

- 5394f91: Adds the daily money-in vs money-out figures that power the new Finance Analytics cash-flow chart.

## 0.1.6

### Patch Changes

- e81cead: Sales fixes: per-customer vouchers applied at the counter now discount the bill correctly, and receipt photos and attachments now upload and display reliably (previously some images failed to save and showed a broken link).

## 0.1.5

### Patch Changes

- 5914e0f: Account logo images in transaction payment legs (visible in the ledger list and the transaction detail modal) now load from the kernel's org-scoped `/assets/` URL instead of the legacy `/api/financial-accounts/:id/logo` endpoint that no longer exists. Previously-broken logos render again.

## 0.1.4

### Patch Changes

- 9e67d88: Active rentals stay visible on today's counter board even when the cashier rang them up under yesterday's date. Previously, a still-running session whose receipt was backdated would silently disappear from "Live" the moment the day rolled over Manila midnight, even though the rental was visibly in progress; it only reappeared when staff flipped to "Yesterday".
- 9e67d88: Fix counter charges failing for multi-customer receipts. Previously, ringing up two or more customers on the same receipt returned "transaction_date and started_at must be provided together" and the charge wouldn't post. Mixed-customer receipts now record correctly, each customer's start time is honored on their own line items, and a batch code stamps the receipt so staff can recognize rows that belong to the same group booking.

## 0.1.3

### Patch Changes

- af79da3: Transaction receipt and attachment images now load from the kernel's new org-scoped `/assets/` URL. Previously-broken images will render again once their files are restored on the new server.

## 0.1.2

### Patch Changes

- c2acd59: Record Transaction and Export Transactions modals now use their intended width (≈48rem at large screens, ≈42rem at medium) instead of stretching across the full window. The account-picker tiles inside the modal also switch from 2 columns to 3 columns at tablet widths as designed.

## 0.1.1

### Patch Changes

- 9b0da27: Internal: the transactions plugin now stands up the export-job tracker and the per-transaction running-total table, and on first boot after a restore from the older monolith it moves the legacy customer-link and subcategory rows into their new homes. No visible change — opening an export or recording a payment continues to work the same way.
