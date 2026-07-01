# @kahitsan/kplugin_transactions

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
