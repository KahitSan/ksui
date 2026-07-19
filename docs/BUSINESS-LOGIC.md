# Finance Plugin — Business Logic

## How to read this document

This is a plain-language map of every rule the finance plugin enforces — what happens to
receipts, payments, accounts, and subscriptions. It's written for anyone who manages the front
desk, runs reports, or makes calls about money — no engineering background needed.

Each **Feature** section opens with one or two sentences on what it's for, then a table of
**Scenarios**: a real situation, in "if this happens, then that happens" form. Every row gives
the *why* where one is known, plus two columns for engineers — where the rule lives in code, and
which test proves it. Rejections get their own rows too — a rejection is a business rule.

**Open questions** (at the end) lists everything the verification pass couldn't confirm from
code and tests alone. Each one needs a yes/no from whoever owns that business rule.

Each feature's stamp line shows when it was last re-verified against source, when its cited
code and tests last actually changed in git, and any open questions or unverified rows tied to
it. A citation that no longer resolves shows as "citation drifted" in that same line — the
strongest signal that row needs a human look. `node scripts/doc-freshness.mjs` refreshes these
stamp lines in place; run it whenever code or tests change.

## Verification

Five agents independently re-verified this document on 2026-07-19, each working blind to the
others' output. Three adversarial verifiers re-derived a slice of the tables directly from
source: `verify-charge` covered Features 1, 4, 5, 6, 7, 8; `verify-edit` covered Features 2, 3,
4; `verify-other` covered Features 9–20. Two blind inventories worked with zero visibility into
this document: `enum-code` listed every behavior found in the plugin's route/lib code,
`enum-tests` listed every behavior found in the test suite. Both inventories were then diffed
against this document's tables to catch behaviors the original mapping pass missed.

- **Rows confirmed as written:** the large majority — every feature not called out below checked
  out against both code and (where cited) test assertions.
- **Rows corrected:** 11. 5 had wrong code-line citations (pointing at a comment or an unrelated
  block, not the real enforcement). 1 had a wrong rule claim (a subcategory "active-list" check
  that doesn't actually filter on active). 1 had a mischaracterized formula (EWT rounding —
  flagged as suspicious, but algebraically the standard round-to-cents order). 1 was an
  unverifiable-without-UI-code claim, now flagged as such. 1 resolved a false open question (the
  single-payer DB constraint test does contain the assertion in question). 2 rows got test
  citations they were missing.
- **Rows added:** 3 new feature sections the original pass never reached — `GET /outstanding`,
  CSV export, and the live-board SSE stream, all real HTTP surface with no prior coverage — plus
  corrections/new rows folded into Features 2, 3, 11, 13, 15, 18, and 20.
- **Rows still unverified:** 1. Feature 18's "balance computation unavailable → dash" row needs
  a UI-code check this pass didn't do; flagged inline as `⚠ unverified`.
- New open questions from the verifiers are folded into **Open questions** below (items 15–18).
  Two previously-open questions — the single-payer DB rule and `/extend`/`/charge-overage` test
  coverage — were resolved with citations during this pass and pruned from the list; their
  resolutions live in Features 20 and 3.

## Feature index

| # | Feature | What it covers |
|---|---|---|
| 1 | POS Charge | Turning a shopping cart into a committed sale |
| 2 | Editing a Paid Receipt (Cart Edit) | Adding/removing items on a receipt after checkout |
| 3 | Extending a Rental / Billing Overage | Continuing a stay, or billing for time already elapsed |
| 4 | Voiding a Single Line Item | Removing one item from a receipt |
| 5 | Void, Unvoid, Forfeit, Soft-Delete | Whole-receipt cancel/restore/write-off |
| 6 | How "Paid / Partial / Unpaid" Is Decided | The shared rule behind every payment-status label |
| 7 | Payments (Settlement Legs) | Recording/editing/removing individual payments against a receipt |
| 8 | Counter Quick-Edits | Client pool swap, reschedule, reassign — narrow front-desk fixes |
| 9 | Transaction List | The main receipts board |
| 10 | Transaction Detail | The single-receipt drill-down |
| 11 | Manual Transactions | Income, expense, transfers, payables — VAT, EWT, transfer fees |
| 12 | Sharing & Privacy Controls | Who can see a private receipt |
| 13 | Subcategories | The income/expense sub-labels |
| 14 | Attachments | Receipt photos and proof-of-payment uploads |
| 15 | Analytics & Reporting | Summary, cashflow, by-hour, grouped-by-date, creators |
| 16 | Subscriptions & Renewals | Recurring-revenue view + the renew action |
| 17 | Package Eligibility Check | The "has this client already availed X" promo gate |
| 18 | Financial Accounts | Bank/wallet/cash ledgers, balances, logos |
| 19 | Payees | Vendor/customer list used on manual entries |
| 20 | Multi-Tenant Isolation Guarantee | Your business's data never touches another business's |
| 21 | Outstanding Balances | The unpaid-receipts list used to chase down collections |
| 22 | CSV Export | Downloading receipts as a spreadsheet report |
| 23 | Live Board Updates | How the front-desk board refreshes when another terminal makes a change |

---

## 1. POS Charge

Verified 2026-07-19 · logic changed 2026-07-10 · tests 2026-07-16 · open: Q1, Q2

**What it does:** Turns a cart into one committed sale in a single save. Line items, an
optional multi-customer split, discount code, and custom start time are all part of that save,
along with (usually) a payment. Route: `POST /charge`.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A cashier submits a valid cart with at least one item. | One sale is created with one line per cart item. If any amount was collected (or nothing was specified — defaults to the full total), one payment is recorded too. Total = cart subtotal minus discount, floored at zero. | — | `run-charge.ts:103,194,388-444` (sale + lines); the payment leg itself is a separate block at `run-charge.ts:487-499` | No dedicated unit test; pinned indirectly by the multi-customer + cross-tenant integration tests below |
| A line item has no package attached at all. | Accepted — a "manual" line works even when the packages catalog plugin is off. | Not every sale is a package; the register still has to ring up a plain add-on. | `validate.ts:19-21` | — |
| A line item has only half a package reference (package set, variant missing, or vice versa). | Rejected — the cart is malformed. | Half a reference can't be priced. | `validate.ts:135-144` | — |
| A line's price is absurdly large (beyond the ledger's storage limit). | Rejected with a clean error instead of a raw database crash. | An unbounded price would otherwise error ugly, not clean. | `validate.ts:11-14,129-134` | — |
| A cart references a package, but the packages plugin isn't running. | Rejected — "remove package line items or enable the packages plugin." | The price/validity of a package line can't be established without the catalog; silently dropping it would misprice the sale. | `run-charge.ts:77-86` | — |
| A cart's package_variant_id doesn't belong to the stated package, or doesn't exist in this workspace. | Rejected, not found. | — | `run-charge.ts:87-99` | — |
| A voucher code is entered and the cart clears its minimum purchase. | Discount applied — percentage, fixed, or free, capped, never negative — to the sale total. Response confirms the code and discount. | — | `run-charge.ts:107-134`, `voucher-discount.ts` | — |
| A voucher code is entered but the cart is below its minimum purchase. | Rejected — the code doesn't apply yet. | — | `run-charge.ts:126-130` | — |
| A voucher code doesn't resolve. | Checks whether the vouchers add-on is installed. If not installed, proceeds at full price and says so. If installed but the code is invalid, rejects it. | A missing add-on and a bad code must never look the same to the cashier. | `run-charge.ts:109-121`, `probe-voucher.ts:10-11` | No test found isolating this branch for `/charge` specifically — Open Q2 |
| A manual discount amount is typed in (no voucher code). | Trusted as entered, no server recalculation. | Matches how the legacy system always worked. | `run-charge.ts:135-138` | — |
| A cart is split across multiple customers on one receipt. | Exactly one customer must be marked payer. Every cart item must belong to exactly one customer group — none left out, none double-counted. Every group needs a name. | The receipt stays 1:1 with the till slip so accounting stays clean, even with several people on it. | `validate.ts:32-37,258-343` | `charge-multicustomer-from-parent.test.ts:163`; single-payer DB rule separately in `transaction-customer-groups-single-payer-index.test.ts` |
| A multi-customer cart also sets a top-level custom start time. | Rejected — start time must be set per customer group, not for the whole receipt. | Two customers on one receipt can have different start times. | `validate.ts:54-60,199-212` | — |
| A customer group has its own start time. | Every item in that group starts there. A group with no start time starts at the moment of charging. | — | `validate.ts:54-60`, `run-charge.ts:355-371` | `charge-multicustomer-from-parent.test.ts:163-` |
| A customer group has its own discount code. | Discount is computed against just that group's own subtotal, not the whole cart. It's rolled into the receipt's total. A code that fails to resolve is quietly dropped, not blocked. | — | `run-charge.ts:140-192` | — |
| A cart has 2 or more customer groups. | The receipt gets a shared batch code. A single-customer sale never gets one. | Lets staff spot a linked group booking at a glance. | `run-charge.ts:267-277` | — |
| A multi-customer charge is added on top of an existing receipt (`parent_transaction_id`). | A brand-new receipt is created (never reusing the original's id), correctly attributed to each customer. | — | — | `charge-multicustomer-from-parent.test.ts:163-219` |
| A sale is dated in the past. | Flagged as backdated. The backdate reason is kept only when it actually is backdated. Its line items start already-completed, not live. | A backdated sale represents something that already happened — it shouldn't show a live countdown. | `run-charge.ts:293-298,403-406` | — |
| A single-customer cart supplies only one of transaction_date / start time (not both). | Rejected — must supply both or neither. | Mixed input would let the calendar entry drift from the line items' timing. | `validate.ts:194-197,213-218` | — |
| A cart names one or more clients (via any of three supported shapes). | One customer-pool entry is saved per unique client, in the order given. | — | `run-charge.ts:446-485` | — |
| The amount collected is more than the total, or nothing is specified. | The recorded payment is capped at the total, never more. Overpay is treated as change and never saved. If the capped amount is zero, no payment record is created. | Change given at the register isn't revenue and shouldn't appear as a payment. | `run-charge.ts:487-499` | — |
| The sale is charged against a financial account from a different workspace. | Rejected, not found — never a raw crash. | Without this check, one business could point a sale at another business's account. That would corrupt its balance, with no database rule to catch it. | `run-charge.ts:231-238` (222-229 is a separate, similar-looking guard — the `parent_transaction_id` ownership check) | `charge-cross-tenant.leak.test.ts:138,155` |
| A voucher is applied and the sale completes. | The voucher's usage count is *supposed* to go up, but today that step is a documented no-op — the vouchers add-on doesn't yet expose a way to record usage. | Left as a stub for when that capability ships. | `charge.ts:140-151` | Open Q1 |

---

## 2. Editing a Paid Receipt (Cart Edit)

Verified 2026-07-19 · logic changed 2026-07-19 · tests 2026-07-19 · open: Q5

**What it does:** Lets staff edit a receipt after checkout — remove or shrink items, add new
items (to an existing customer or a brand-new one), and reassign who's paying — in one save on
the SAME receipt. It never creates a second receipt. Route: `POST /:id/apply-cart-edit`.

### Request validity (nothing is saved if any of these fail)

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| The save has no edit token, or no reason. | Rejected. | The edit token is what makes a retried click safe (see idempotency below); the reason is what shows up in the audit trail. | `transactions-cart-edit.ts:163-168` | — |
| The save asks to remove more of an item than actually exists, or references an item that isn't real. | Rejected. | — | `:171-173` | — |
| An addition doesn't specify exactly one destination — an existing customer group, or a brand-new one. | Rejected — never both, never neither. | — | `:131-145` | — |
| Payer reassignment is requested with a non-existent/invalid target. | Rejected. | — | `:184-191` | — |
| The same save both reassigns the payer AND flags a brand-new group as payer. | Rejected — mutually exclusive. | Two conflicting instructions about who's paying can't both be honored. | `:195-197` | `cart-edit-payer-reassignment.test.ts` |
| More than one addition in the same save claims payer status for its new group. | Rejected — at most one. | — | `:198-200` | — |
| The save asks for nothing at all (no reductions, additions, or payer change). | Rejected. | — | `:204-206` | `cart-edit-invalid-quantity.test.ts` |
| The save has only reductions (additions left empty), or only a reschedule/pool fix fired alongside it. | Accepted — an empty additions list is a legitimate no-op, not an error. | Not every save needs to add something. | `:174-176` | — |
| A new item's quantity is zero, negative, or infinite. | Rejected, and nothing is changed anywhere. | Quantity here means "how many periods of this package," matching the extend flow's rule — it just has to be a real positive number. | `:108-110` | `cart-edit-invalid-quantity.test.ts` (0, -1, Infinity all rejected) |
| A new item's start-time instruction isn't "now," a real chain-off-another-line, or a real timestamp. | Rejected. | — | `:97-106` | `cart-edit-malformed-anchor.test.ts` |
| A new item's price, name, or duration is supplied by the client. | Ignored — always looked up fresh from the package catalog. | The client can never dictate its own price. | `:36-40,212-216` | `cart-edit-addition-existing-group.test.ts` |
| A new item's catalog reference doesn't exist, or belongs to another workspace. | Rejected. | — | `:244-248` | `cart-edit-unknown-variant.test.ts` |
| The packages catalog itself is offline when an addition is attempted. | Rejected with "enable the packages plugin" — no guessed price. | — | `:229-236` | — |
| A resolved catalog price exceeds the ledger's storage limit. | Rejected cleanly rather than a raw database error. | — | `:249-254` | — |

### Locking, retries, and closed receipts

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| Two edit calls hit the same receipt at the same instant. | The receipt is locked first. The second call waits for the first to finish, then reads back the first call's already-saved result instead of racing it. | Prevents two saves from double-applying or corrupting each other. | `:264-269` | `cart-reduction-concurrent-idempotency.test.ts` (real two-connection test — one mutation, both callers see the same result) |
| The target receipt id doesn't exist in this workspace. | Rejected, not found. | — | `:270-273` | `cart-reduction-cross-tenant.leak.test.ts` |
| The receipt is already voided. | Rejected — "Transaction is voided and cannot be edited." | Reworking a written-off receipt would silently corrupt its final numbers. | `reprice-parent-transaction.ts:72-82` | `cart-edit-parent-lifecycle-guard.test.ts` |
| The receipt is already forfeited. | Rejected — "Transaction is forfeited and cannot be edited." | Same reason — a closed book stays closed. | same as above | same as above; same guard shared by extend/overage — `line-items-extend-parent-lifecycle-guard.test.ts` |
| The exact same edit is submitted twice (e.g. a retried click). | The second call returns the identical saved result from the first call and changes nothing further. | Makes a network retry safe — never double-applies an edit. | `:280-292` | `cart-edit-idempotency.test.ts`, `cart-reduction-idempotency.test.ts` |
| Every save through this route, whatever the mix of adds/removes, is filed in the audit log under the same internal label. | Intentional and stable — relabeling it would only churn existing tests for no real benefit. | — | `:706-709` | — |

### Removing or shrinking items (reductions)

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| Multiple copies of the same item exist on a receipt (e.g. an original booking plus a later top-up) and some quantity is being removed. | The most-recently-added copy is unwound first, the original last. | So a later top-up undoes before the original booking does. | `:326-328` | — |
| A reduction targets an item combination that isn't currently active on the receipt. | Rejected, nothing found to reduce. | — | `:316-319` | — |
| A reduction asks to leave the same or a higher quantity than what's currently there. | Rejected — a reduction must actually reduce. | — | `:321-324` | — |
| Enough is removed to zero out one copy of an item entirely, vs. only part of it. | Whole copies are voided first; a partially-touched copy just has its quantity shrunk. | — | — | `cart-reduction.test.ts` (voids a full line, drops the total), `cart-reduction-partial-quantity.test.ts` (3→1 without voiding) |
| An item's quantity is reduced. | Its start/end time is never touched by the reduction — only its quantity/status. | — | — | `cart-edit-anchor-semantics.test.ts` |
| Several reductions land on different customer groups in the same save. | All of their cost changes are added up per group before the receipt's total is recalculated — order between them doesn't matter. | — | `:294-299` | — |

### Adding items

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| An addition targets an existing customer group. | Only allowed if that group genuinely belongs to this receipt and this workspace. | — | `:420-428` | `cart-edit-addition-group-cross-workspace.test.ts` (404s, mutates nothing) |
| New items are added directly onto an existing group. | The new lines are attributed to that group's own customer; the receipt id never changes. | — | — | `cart-edit-addition-existing-group.test.ts` |
| Several new customer groups are added, one after another. | Each gets the next open "seat" position — safe only because the receipt stays locked for the whole call. | — | `insert-line-items.ts:180-183` | `cart-edit-new-group-position.test.ts` |
| A new group references a discount code that doesn't resolve. | Quietly skipped rather than blocking the save. | A bad reference shouldn't crash a legitimate edit. | `:209-215` | — |
| A new customer group is flagged "this one pays." | It's inserted as NOT the payer, then flipped to payer in one dedicated, separate step afterward. | A receipt can only ever have one payer at the database level — inserting a second "payer" row directly would collide with whoever is currently marked payer. | `:385-395`, DB rule added by `migrations/20260716000000_add_transaction_customer_groups_single_payer_index.ts` | — |
| A new group names a real client. | That client is added to the receipt's customer pool automatically. | — | `:405-417` | — |
| A receipt grows from one customer group to two-or-more for the first time. | It gets a shared batch code, once — a receipt that already has 2+ groups never gets a second one assigned. | Lets staff spot a linked group booking at a glance. | `:359-367,531-542` | `cart-edit-addition-new-group.test.ts` |
| A new item's start-time instruction is "now." | It starts at the moment of the save. | A newly-added package is a fresh charge, not a continuation of something else. | `:450-454` | `cart-edit-anchor-semantics.test.ts` |
| A new item's start-time instruction is a specific timestamp. | Accepted only if it falls within 5 years in the past to 1 day in the future. | A timestamp further off than that is almost certainly a client bug, not a real booking time, and should be rejected rather than silently corrupt the line's timing (an explicitly judgment-call bound — see Open Questions). | `:459-464` | 3 tests: >5yr past 400s, >24h future 400s, exact-ISO happy path |
| A new item's start-time instruction chains off another line on the receipt. | Starts exactly when that other line ends. | The client never has to compute or send a timestamp itself. | `:474-477` | "lands the new line at the source's ends_at" |
| The line being chained off belongs to a DIFFERENT receipt. | Rejected — chaining only works within the same receipt. | — | `:484-487` | "rejects a chain_from_line_id pointing at a different transaction" |
| The line being chained off has no end time. | Rejected — nothing to chain from. | — | `:489-491` | — |

### Changing or removing a voucher on an existing group

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A save wants to attach, swap, or remove the voucher on a customer group that already exists on the receipt. | Sent as its own `voucher_changes` list, separate from additions. | Additions are skipped entirely when their items list is empty, so a voucher-only change can't ride inside one — it needs its own path. Before this, there was no way to change an existing group's voucher at all; the only place a voucher_id was ever written was creating a brand-new group. | `:73-90,157-163` | `cart-edit-voucher-change.test.ts` |
| A `voucher_changes` entry is missing a customer group, or its voucher_id isn't a number or null. | Rejected. | — | `:202-210` | `cart-edit-voucher-change.test.ts` |
| A save's only content is a voucher change (no reductions/additions/payer reassignment). | Accepted — it's a legitimate reason to save on its own. | — | `:229-235` | `cart-edit-voucher-change.test.ts` |
| A voucher_change names a voucher code that doesn't resolve in this workspace. | Rejected before anything is touched — unlike a brand-new group's voucher (which is quietly dropped so a bad reference can't block group creation), an explicit voucher change IS the point of the request, so a bad one must fail loudly. | — | `:289-301` | `cart-edit-voucher-change.test.ts` (400s, mutates nothing) |
| A voucher_change's customer group doesn't belong to this receipt. | Rejected. | — | `:598-606` | `cart-edit-voucher-change.test.ts` |
| A voucher is attached, swapped, or removed on a group. | The group's discount is recalculated against its current subtotal right away, even if nothing else about the group changed in this save. | Otherwise the new (or removed) voucher wouldn't actually take effect until some unrelated future edit touched the group's cost. | `:590-627` | `cart-edit-voucher-change.test.ts` |
| A group's voucher is removed. | Its discount drops to zero — never left at its old value. | The old value belonged to the voucher that's now gone; leaving it would silently overcharge the discount. | `reprice-parent-transaction.ts:105-124` | `cart-edit-voucher-change.test.ts` ("voucher REMOVAL (null) zeroes the discount") |
| A voucher change and a reduction land on the same group in the same save. | Both apply together — the discount is computed against the post-reduction subtotal. | — | `:590-627` | `cart-edit-voucher-change.test.ts` ("combined with a reduction") |

### Who's paying

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A save both explicitly reassigns the payer AND has a brand-new group flagged as payer. | The explicit reassignment wins. | — | `:554-558` | — |
| The payer changes. | It's one single all-or-nothing switch across every group on the receipt. | There's never a moment where two groups (or zero) are marked payer, even if the save crashes mid-way. | `:559-564` | — |
| The new payer target doesn't belong to this receipt. | Rejected. | — | `:573-576` | — |
| The payer changes. | The receipt's own top-level "billed to" name is updated to match automatically. | This route is the only place that flips who's marked payer for an existing group, so it also owns keeping the receipt's own name in sync. | `:577-590` | `cart-edit-payer-reassignment.test.ts` |

### Safety nets that block a bad save

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| Every item belonging to the current payer is removed, and no reassignment was supplied, while another group still has active items. | Rejected — "The payer's items were all removed. Reassign the payer to a customer with active items." | Server-side backstop so a stale app or a direct API call can never strand billing on a customer with nothing on the receipt. | `:593-622` | `cart-edit-payer-reassignment.test.ts` (also proves reassigning INTO a still-empty group still 409s — checked after the flip, not before) |
| A save would leave the receipt with zero items on it at all. | Rejected — "Void the whole transaction instead." | — | `:627-638` | `cart-reduction-empty-cart.test.ts`; family-of-tests confirms this only ever looks at THIS receipt, never a linked one (`cart-edit-guards-same-tx.test.ts`, `cart-reduction-family-empty-cart.test.ts`) |
| A save in the same call adds enough new value to offset a zeroing reduction. | The zero-cart / refund-block guards clear and the save proceeds. | — | — | `cart-edit-guards-same-tx.test.ts` |
| A save would drop the receipt's total below what's already been collected. | Rejected — "This would reduce the total below the ₱X already paid. Refunds are handled manually." | Refunds are explicitly out of scope for this route — no automated refund path exists. | `:656-685` | `cart-reduction-refund-block.test.ts`; same-tx-only scoping confirmed by `cart-edit-guards-same-tx.test.ts`, `cart-reduction-family-refund-block.test.ts` |
| An addition is made to an already-paid receipt. | The new balance shows correctly as partial, and never spawns a second $0 receipt. | — | — | `cart-edit-payment-balance.test.ts` |

### What happens after a successful save

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| Any save that changes the active items on a receipt. | The receipt's stored title/description is regenerated from what's currently active on it. | The detail view and the edit form both read the stored title directly, unlike the list (which recomputes live) — without this, they'd keep showing a removed package's name. | `:640-654` | `transactions-list-summary-after-cart-edit.test.ts` |
| A save is payer-reassignment-only (nothing else changed). | The stored title is left as-is. | — | — | same test file |
| A customer group (or the receipt itself) has a discount code attached, and its subtotal changes. | The discount is recalculated against the NEW subtotal rather than just adding the raw cost — group-level takes precedence over receipt-level when both exist. | Otherwise a discounted booking would silently lose its discount partway through an edit. | `reprice-parent-transaction.ts:1-4,84-90` | `cart-reduction-voucher.test.ts`; combined-call isolation in `cart-edit-combined-reduce-and-add.test.ts` |
| That same recalculation runs, but the attached voucher can no longer be resolved (deleted, or the vouchers plugin is down). | The existing discount amount is left completely unchanged — never zeroed out, never an error. | Losing the ability to look up a voucher shouldn't silently strip a discount the customer was already promised. | `reprice-parent-transaction.ts:110-118,127-133` | — |
| Anything fails partway through a save (a bad reference in the second of several additions, etc.). | Everything in that save is undone, including earlier reductions/additions processed in the same call — the whole save is all-or-nothing. | — | — | `cart-edit-atomicity.test.ts` |
| A save succeeds and isn't a pure replay. | Exactly one permanent log entry is written recording exactly what was asked for. | — | `:702-716` | — |

---

## 3. Extending a Rental / Billing Overage

Verified 2026-07-19 · logic changed 2026-07-16 · tests 2026-07-16

**What it does:** Adds a new line item to an ongoing or just-finished rental. `/extend`
continues the same stay forward; `/charge-overage` bills for time already elapsed past a booked
end. Both update the receipt's total (and any discount) in the same save.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| Overage is billed with a missing/invalid catalog item or a zero/negative quantity. | Rejected. | — | `line-items-extend.ts:...` | — |
| Overage is billed against an item that's already been completed or voided. | Rejected — overage only applies to something still checked-in or already overdue. | — | `:80-83` | — |
| Overage is billed against an item whose booked end time hasn't passed yet (or has none). | Rejected — "charge-overage is only valid for overdue line items." | Overage is strictly for time already elapsed, never in advance. | `:84-87` | — |
| Overage/extend is attempted on a voided or forfeited receipt. | Rejected. | Same closed-book reason as cart-edit. | shared `assertParentEditable` | `line-items-extend-parent-lifecycle-guard.test.ts` |
| An overage charge is booked. | It's recorded as already-done, starting exactly when the original booking's window ended. The original booking is left exactly as it was — staff close it out separately. | The overage window is already in the past; it's booked as done from the start. | `:26-28` | — |
| A rental is extended with no anchor specified (the default). | The new segment starts exactly when the original one ends, so the two read as one continuous stay. | Lets the counter view link the segments together visually. | `:191-204` | `extend-voucher.test.ts` — "anchor omitted chains started_at off the source's ends_at exactly" |
| A rental is extended with "start now" explicitly requested. | The new segment starts at the current moment instead. | A brand-new package added mid-edit is a fresh charge, not a continuation — it must not inherit an unrelated future end time. | `:191-204` | `extend-voucher.test.ts` — "anchor 'now' starts the new line at the current time, not the source's ends_at" |
| An extension picks a different package than the one it's extending. | Allowed — a cross-package extension (an upgrade mid-stay) is a legitimate move. | — | `:280-282` | — |
| A new segment is inserted via `/extend`. | It's live (active), unlike an overage charge, which is inserted already-done. | — | — | — |
| Either route inserts a new segment. | The new segment inherits the exact same customer and customer-group attribution as the segment it extends — never re-typed or re-picked. | — | — | `extend-attribution-inheritance.test.ts` covers `/extend` for both the omitted-anchor and explicit-chain cases; code-verified for `/charge-overage` too (both routes pass `src.client_id`/`src.customer_group_id` through to the insert) but `/charge-overage` has no dedicated attribution test of its own |
| Either route successfully adds a segment. | The receipt's total (and any attached discount) is recalculated the same way a cart-edit addition would. | — | — | `extend-voucher.test.ts` and `charge-overage-voucher.test.ts` (each has both a voucher-attached-group case and an unvouchered-cost-only case) |

---

## 4. Voiding a Single Line Item

Verified 2026-07-19 · logic changed 2026-07-16 · tests 2026-07-16

**What it does:** Removes exactly one item from a receipt — unlike cart-edit's bulk
reduce-by-item-type — adjusts the receipt's total, and logs the action. Route:
`POST /:id/line-items/:lineItemId/void`.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A void is requested with no reason. | Rejected. | — | `transactions-status.ts:389+` | `line-item-void-recompute.test.ts:88` |
| A void targets an item that's already voided, or doesn't exist. | Rejected, "not found or already voided" — a repeated click is safe, not double-applied. | The item's own status already prevents a double-void, so no separate replay-safety mechanism is needed here (unlike cart-edit's edit token). | `:429-432` (pre-lock read) and `:457-460` (post-UPDATE zero-rows check — two independent checks producing the same 404) | `line-item-void-recompute.test.ts:120` |
| A void targets an item on a voided/forfeited receipt. | Rejected before anything is touched. | Voiding a line on a closed-out receipt would corrupt its final numbers. | shared `assertParentEditable` | `cart-edit-parent-lifecycle-guard.test.ts` ("leaves the line active") |
| An item is successfully voided. | The receipt's total drops by exactly that item's cost; a discount code attached to it (or its group) is recalculated against the new total. | — | `:461-470` (`costDelta = -(unit_price*quantity)` then `repriceParentTransaction`) | `line-item-void-recompute.test.ts:95` (₱800 sale, one ₱500 line voided, total drops to ₱300) |
| A void only supports removing an item completely. | There is no partial-quantity version of this route — shrinking a quantity is the cart-edit reduction flow's job. | — | — | — |
| A void succeeds. | Logged with the reason. | — | — | — |

---

## 5. Void, Unvoid, Forfeit, Soft-Delete

Verified 2026-07-19 · logic changed 2026-07-10 · tests 2026-07-10 · open: Q8

**What it does:** Governs a receipt's end-of-life states — a reversible cancel (with or without
a paper trail) and a permanent write-off of an unpaid balance.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A receipt is soft-deleted (no reason given). | Marked voided; disappears from the default list. Already-voided target is rejected. | — | `transactions-status.ts:31-60` | `transactions-flow.test.ts:281,286` |
| A receipt is voided WITH a reason. | Marked voided and a permanent log entry is written; a blank reason, or an already-voided target, is rejected. | — | `:63-107` | — |
| Two separate ways exist to reach "voided" — one silent, one logged. | No documented reason found for why both exist. | — | — | Open Q8 |
| A voided receipt is unvoided with a reason. | Restored to completed and logged; a blank reason, or a target that isn't currently voided, is rejected. | — | `:109-153` | — |
| A receipt with an outstanding balance is forfeited. | Its headline total is rewritten down to only what was actually collected. The unpaid portion is written off permanently — the receipt never overstates revenue, even though its balance now reads zero. | The customer is gone for good — the unpaid part was never earned. | `:156-231` | `transactions-forfeit.test.ts` — full lifecycle: ₱100 sale → ₱40 partial payment → forfeit → `amount` becomes "40.00", `forfeited_amount` "60.00" |
| A forfeit is processed. | The receipt is locked first so a payment can't slip in mid-process and be forfeited away. | A concurrent payment must not be written off by accident. | `:176-179` | same test file |
| A forfeit is processed. | Every still-open item on the receipt is force-marked completed. | Stops a live countdown running for a session nobody is coming back to finish; also prevents staff re-triggering forfeit with no visible board change. | `:254-265` | same test file (line item moves to "completed" / board "Done") |
| A forfeit is attempted on an already-voided receipt. | Rejected — "Cannot forfeit a voided transaction." | — | `:199-202` | — |
| A forfeit is attempted on an already-forfeited receipt. | Rejected. | — | — | `transactions-forfeit.test.ts` |
| A forfeit is attempted on a receipt with nothing outstanding. | Rejected — "No balance to forfeit." | — | `:208-212` | — |
| A payment was already collected before the forfeit. | Left completely untouched — still shows as its own payment record. | The money that was actually collected stays collected; only the unpaid remainder is written off. | — | `transactions-forfeit.test.ts` (₱40 leg unchanged) |

---

## 6. How "Paid / Partial / Unpaid" Is Decided

Verified 2026-07-19 · logic changed 2026-07-19 · no tests cited

**What it does:** One shared rule decides the payment-status label shown everywhere a receipt
appears — the list, detail view, and export. It's never stored as its own column; it's worked
out fresh every time.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A receipt is not a sale (e.g. a regular expense entry). | No payment-status label at all. | — | `transactions-core.ts:104-121` | — |
| A receipt is voided. | Labeled "voided," regardless of anything else. | A cancelled receipt should never look "paid" or "unpaid" because of leftover numbers. | same | — |
| A receipt is forfeited. | Labeled "forfeited" — this check runs before any amount math. | Same reasoning — a written-off receipt is a distinct state from a payment state. | same | — |
| A receipt's total is zero, or fully covered by payments. | Labeled "paid." | — | same | — |
| A receipt has some, but not all, of its total covered. | Labeled "partial." | — | same | — |
| A receipt has no payments at all. | Labeled "unpaid." | — | same | — |
| This exact rule (and its exact order) is duplicated across the list, the detail view, and the export. | Kept identical by hand in three places — a change to one must be made in all three. | — | `transactions-core.ts:104-121`, `transactions-detail.ts:~59`, `export.ts:~240` | — |

---

## 7. Payments (Settlement Legs)

Verified 2026-07-19 · logic changed 2026-07-10 · tests 2026-07-10

**What it does:** Records, edits, lists, and removes individual payments against a receipt.
Balance and payment status are always worked out live from these records — never stored
separately, so they can't drift out of sync.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A payment is recorded with a missing/invalid account, or a zero, negative, or non-numeric amount. | Rejected. | An amount check written as "not greater than zero" (rather than "less than or equal to zero") deliberately also catches invalid/garbage input, not just negative numbers. | `payments.ts:160-220,175-178` | — |
| A payment amount exceeds the ledger's storage limit. | Rejected cleanly. | — | — | `charge-cross-tenant.leak.test.ts:283` |
| A payment is recorded against an account from a different workspace. | Rejected before anything is saved. | — | — | `charge-cross-tenant.leak.test.ts:267` |
| An existing payment is edited (account or amount changed). | Same validation as recording a new one; reassigning to another workspace's account is rejected. | — | `payments.ts:...` | `charge-cross-tenant.leak.test.ts:304,320` |
| Payments on a receipt are listed. | Shown oldest-first, each with its account's name attached. | — | `payments.ts:120-158` | — |
| A payment is deleted. | Removed; deleting one that doesn't exist (wrong workspace or wrong id) is simply a no-op "not found," not an error. | — | `payments.ts:222-247` | — |
| A receipt's balance/payment-status is displayed anywhere. | Always computed live from the sum of its actual payment records — never a separately-stored number that could go stale. | — | — | — |
| Workspace A tries to read/update/delete workspace B's payment, including through a raw internal query path. | Fails at every layer, proving the isolation wall holds regardless of which code path is used. | — | — | `transaction-payments.leak.test.ts` |

---

## 8. Counter Quick-Edits

Verified 2026-07-19 · logic changed 2026-07-16 · tests 2026-07-16 · open: Q3

**What it does:** Three narrow, reason-required fixes let front-desk staff correct a live
receipt without opening the full edit flow: swap the customer pool, reschedule a group's start
time, or reassign a group's billed-to client.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| The client pool is swapped, with a reason. | The pool is fully replaced and logged. Malformed client list, or a blank reason, is rejected. | — | `transactions-counter-patch.ts:20-83` | — |
| A completed (settled) item's start time is rescheduled into the FUTURE. | It reopens back to active. | A completed status means "done" — a start time now in the future contradicts that, so it's narrowly reopened. | `:150-155` | `transactions-counter-patch.test.ts:147` |
| A completed item's start time is backdated into the PAST. | Its status stays completed — the reopen rule doesn't fire. | — | — | `transactions-counter-patch.test.ts:161` |
| A rescheduled item has a fixed duration. | Its end time moves along with the new start time automatically. | Leaving the end time stale would put the end before the start, and the natural-day view would then bucket a today session onto the wrong day's board. | `:130-137` | — |
| A reschedule targets "no customer group" (legacy/ungrouped lines). | Only matches THIS receipt's ungrouped items — never another receipt's, even if it also has ungrouped items. | — | `:157` (the `WHERE customer_group_id IS NOT DISTINCT FROM $2 AND transaction_id = $3` clause — `:100-103` is only the comment explaining what a `null` group id means, not the scoping itself) | `transactions-counter-patch.test.ts:243` |
| A reschedule targets a customer group id that doesn't exist on this receipt (wrong id, or belongs to a different receipt). | Rejected entirely, and NOTHING is logged. | A stale/wrong target must never look like a successful edit in the history. | `:161-166` | `transactions-counter-patch.test.ts:176,266` |
| A customer group's billed-to client is reassigned. | Every item under that group is updated to the new client; if that group is the payer, the receipt's own top-level billed-to name is synced too. | So the receipt-card header (which reads the receipt's own name, not the group's) reflects the change without a refresh. | `:247-259` | No dedicated test found — Open Q3 |
| A walk-in's display name is (or isn't) supplied along with a client reassignment. | Optional — client-linked groups always resolve their current name live, so this field only matters for true walk-ins. | — | `:228-234` | — |

---

## 9. Transaction List

Verified 2026-07-19 · logic changed 2026-07-19 · tests 2026-07-07

**What it does:** The main receipts board — paginated, filterable, searchable, and
privacy-scoped. Enriched with computed status, balance, item summary, and names resolved from
other plugins. Route: `GET /api/transactions`.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A non-elevated staff member views the list. | Only sees receipts they created, were explicitly shared on, or their role was shared on; admins/superusers see everything. | — | `shared.ts:238-244` | `unit/shared.test.ts` |
| Filtering by category (sale, expense, etc.). | Selecting every valid category is treated the same as no filter at all. | — | `transactions-core.ts:88-97` | — |
| No status filter is given. | Voided receipts are excluded by default; explicitly asking for "active" behaves the same as asking for nothing. | — | `shared.ts:196-201` | — |
| A search term contains a "%" character. | The "%" is escaped so it only matches a literal percent sign, never widens the match. | — | `shared.ts:124-126,228-231` | `unit/shared.test.ts` |
| A date filter is malformed (not a real date). | Silently skipped rather than crashing the whole list. | — | `shared.ts:218-220` | — |
| Filtering by financial account. | A receipt matches if that account was the source, the destination, or received a payment leg from it. | — | `shared.ts:203-212` | — |
| Sorting by a column not on the recognized list. | Silently falls back to sorting by date. | Closes off a way to manipulate the sort into breaking the underlying query. | `transactions-core.ts:102` (the fallback branch itself; `shared.ts:12-19` only declares the allowlist array it checks against) | `unit/shared.test.ts` pins the allowlist's *contents* only — it doesn't exercise the fallback branch, so it wouldn't catch a regression there |
| Another plugin (accounts/payees) is unreachable. | The list still loads; names come back blank and the response flags which service was unreachable. | — | `transactions-core.ts:191,208,230-232` | — |
| A sale receipt has active items on it. | Its displayed title is recomputed live from those items, never trusted from the stored column. | Heals receipts edited before description-regeneration existed, without needing to re-save them; package names can't be resolved in a plain SQL join since packages lives in a separate plugin. | `transactions-core.ts:126-183` | — |
| Any other view of receipts (grouped-by-day, subscriptions, cashflow, summary). | Reuses this exact same filtering/privacy logic. | So none of those views can ever silently disagree with what the list itself shows. | `shared.ts:169-177` | `grouped-by-date.test.ts` |

---

## 10. Transaction Detail

Verified 2026-07-19 · logic changed 2026-07-19 · tests 2026-07-19 · open: Q6

**What it does:** The full drill-down on one receipt — items, payments, customer groups, client
pool, edit history, attachments, payee, and who it's shared with. Route:
`GET /api/transactions/:id`.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| Someone with no access opens a private receipt they didn't create. | Returns "not found," not "forbidden." | Hides the receipt's existence entirely, not just its contents. | `transactions-detail.ts:78-89` | No dedicated test found beyond the list's analogous rule — Open Q6 |
| The creator, or an elevated user, opens a private receipt. | The full sharing list (people and roles) is shown; anyone else sees an empty list, even if it isn't actually empty. | Non-owners never learn who else can see a private receipt. | `:97-106` | — |
| A receipt has voided items on it. | They're excluded entirely from the detail view. | Matches what every screen expects — neither the itemized summary nor the edit-form seed wants a voided item shown as if still on the receipt. | `:108-121` | — |
| A customer group has a real client attached. | Its displayed name is resolved live from the client record, overriding whatever was typed at checkout time; a true walk-in keeps the stored name. | A stored name goes stale the moment a client is renamed or reassigned; live lookup fixes that, with a graceful fallback if the client lookup service is down. | `:233-248` | — |
| A receipt has a linked transfer fee. | The linked fee's amount is joined into the response. | — | `:50,65-67` | — |
| A receipt's line items are shown. | The title is recomputed the exact same way as the list, capped to the first 3 items. | Guarantees the detail title and the itemized pane can never drift apart. | `:147-160` | — |
| A customer group carries a voucher (`voucher_id` set). | The response attaches a resolved `voucher` object (`id`, `code`, `type`, `value`, `max_discount_amount`, `minimum_purchase`) alongside the raw `voucher_id`, resolved per group over the same vouchers-plugin RPC other peer lookups use. | The edit cart needs the real code and the two discount-math fields to preview a voucher change, not just the opaque id. | `:244-277` | `integration/transactions-detail-voucher.test.ts` |
| A group's `voucher_id` doesn't resolve (vouchers plugin absent, or the id no longer exists). | `voucher` is `null`; the raw `voucher_id` column is left untouched. | Same graceful-degradation posture as every other peer lookup on this route — a down/missing peer never breaks the read. | `:244-262` | `integration/transactions-detail-voucher.test.ts` |
| A legacy single-customer receipt (no `customer_group` rows) carries a top-level `voucher_id`. | The response also attaches a resolved top-level `voucher` object, same shape as a customer group's, resolved from the transaction's own `voucher_id` column. | Legacy receipts never got customer-group rows, so they were falling through the group resolution above entirely — the edit cart's synthetic single group reads `data.voucher` and needs the real fields, not just the id. | `:279-297` | `integration/transactions-detail-voucher.test.ts` |

---

## 11. Manual Transactions

Verified 2026-07-19 · logic changed 2026-07-10 · tests 2026-06-20 · open: Q10

**What it does:** Handles income, expense, transfer, and payable entries typed in directly, not
through the POS. Covers create and edit, plus VAT, withholding tax, and transfer-fee handling.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A transfer ("business" category) entry sets a transfer fee. | A SECOND linked expense entry is created automatically for that fee, in the same save, pointed back at the original. | — | `transactions-core.ts:458-501` | — |
| A transfer fee is set on a non-transfer entry. | Rejected. | — | `:310-313` | — |
| A transfer fee is set with no source account. | Rejected. | — | `:321-324` | — |
| An entry is dated before today (backdated). | Requires a special permission AND a stated reason. | — | `:336-346` | `unit/backdate.test.ts` — same-day is NOT backdated; a future-dated entry IS treated as backdated |
| A "payable" entry is created. | Must pick a recognized type (subscription/utility/rent/loan/tax/other); a cheque number defaults its status to "issued" unless told otherwise, and any given status must be recognized. | — | `:349-371` | — |
| Any entry is saved with a tax setting. | Tax is fixed at 12%, computed one of four ways: inclusive (back the tax out of the total), exclusive (add tax on top, bumping the stored total up), exempt, or non-VAT (no tax). | — | `:373-391` | — |
| An entry has withholding tax turned on. | The rate must be between 0 and 100; the withheld amount is `round(amount × rate) / 100`. | This is the standard round-to-cents formula, not a nonstandard order. It's algebraically identical to "divide the rate by 100 first, then round," since multiplication and division associate. Re-derived and confirmed during verification — no accounting risk. | `:394-405` (create), `:750-777` (edit) | No isolated unit test found for the formula alone |
| An entry's amount exceeds the ledger's storage limit. | Rejected cleanly. | — | `shared.ts:25-29` | — |
| An entry references a bank/wallet/cash account from a different workspace. | Rejected before saving. | — | `:413-420` | — |
| An entry's date is changed. | Whether it counts as backdated (and the backdate reason) is recalculated to match the new date. | Flipping a date to/from today must keep the backdated flag honest. | `:649-675` | — |
| Withholding-tax fields are touched during an edit. | All three (on/off, rate, amount) are rewritten together — never left half-updated. | — | `:752-777` | — |
| A transfer fee amount is touched during an edit. | The linked fee entry is kept in sync: clearing the fee deletes the linked entry, changing it updates or (re-)creates it. | — | `sync-transfer-fee.ts:33-125` | — |
| A transfer fee is auto-created or re-synced as its own linked expense entry, and the parent transfer is private with specific people/roles shared on it. | The linked fee entry's sharing list is always created empty — only the `is_private` flag itself carries over from the parent, never who it's shared with. | Not explained in code — flagged as a likely oversight, not a documented intent. | `sync-transfer-fee.ts:114-118` | — (no test found covering this) |
| An edit is saved with a reason. | Logged. | — | `:860-867` | — |

---

## 12. Sharing & Privacy Controls

Verified 2026-07-19 · logic changed 2026-07-10 · no tests cited

**What it does:** Controls who can see a receipt marked private. Route: `PUT /:id/visibility`.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A receipt's sharing list is updated. | Both the per-person and per-role sharing lists are fully replaced, not merged — the full list must be resent every time. | — | `transactions-status.ts:306-337` | — |
| A receipt is marked not-private. | Any sharing list sent along with that change is ignored. | Sharing only means something when the receipt is actually private. | `:322,330` | — |
| The sharing tables (person/role) have no workspace marker of their own. | Every read/write against them routes through the parent receipt, structurally preventing a cross-workspace delete. | — | `:310-313` | — |

---

## 13. Subcategories

Verified 2026-07-19 · logic changed 2026-06-28 · no tests cited · open: Q15, Q16

**What it does:** The income/expense sub-labels attached to manual entries.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A list request asks for something other than "income" or "expense." | Rejected. | — | `subcategories.ts:31-34` | — |
| A new subcategory's name matches an existing one (case-insensitive) in the same income/expense bucket. | It's treated as re-adding — if the existing one was soft-deleted, it's silently reactivated rather than erroring. | — | `:59-65` | — |
| A subcategory is deleted. | Always soft-deleted (marked inactive), never actually removed. | Historical entries that reference it keep working. | `:120-140` | — |
| Any entry sets a subcategory. | **Corrected.** NOT checked against the active-list rule — `validateSubcategory` matches on name + applies_to only, with no `is_active` filter (unlike `listSubcategories`, which does filter for the dropdown). A soft-deleted subcategory stays fully assignable to new or edited entries indefinitely. Soft-delete only hides it from the picker UI — it doesn't retire the name. | Likely unintentional — soft-delete elsewhere in this plugin (payees, financial accounts) also blocks the value from being reused. | `lib/transaction-subcategories.ts:77-85` (query has no `is_active = TRUE`, contrast `listSubcategories` at `:44-56` which does) | — (no isolated test covers this gap) — Open Q16 |
| The subcategories taxonomy table itself (`accounts.transaction_subcategories`). | Has no `workspace_id` column at all — one shared list across every workspace on the platform. A subcategory created, renamed, or soft-deleted by one business is visible to and reusable by every other business on Hilinga. | Ported as-is from the monolith's public-schema global taxonomy — the migration's own comment calls it deliberately "org-global." Not an oversight, but a real, surprising exception to this plugin's usual per-tenant isolation. | `migrations/20260527000000_create_transactions.ts:186-200`, `lib/transaction-subcategories.ts` (no `workspace_id` anywhere in the file) | — (no test asserts cross-workspace subcategory sharing either way) — Open Q15 |

---

## 14. Attachments

Verified 2026-07-19 · logic changed 2026-07-10 · no tests cited · open: Q14

**What it does:** Receipt photos and proof-of-payment uploads attached to a transaction.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A file is uploaded. | Must be an image (jpeg/png/webp/heic/heif) or PDF, 10MB or under. | — | `attachments.ts:43-47,153-158` | — |
| Any attachment is stored. | Always private — never reachable at a guessable public link. Only viewable through an authenticated, ownership-checked route that streams the bytes back. | — | `:86-91,174-181` | — |
| A file upload succeeds but the database record fails to save. | The now-orphaned file is best-effort cleaned up. | No unreferenced file left sitting in storage. | `:187-206` | — |
| An attachment is deleted, and its underlying file is still referenced by another record (a legacy dedup situation). | The file itself is kept. | Only removed once nothing else points to it. | `:242-254` | — |
| The attachments table has no workspace marker of its own. | Every access always joins through the transaction it belongs to for isolation. | — | `:73-76,104-109,227-233` | Worth confirming against the documented-caveat list in security-audit — Open Q14 |

---

## 15. Analytics & Reporting

Verified 2026-07-19 · logic changed 2026-07-07 · tests 2026-07-07 · open: Q7, Q9, Q17

**What it does:** Summary, cashflow, hourly check-in/out, grouped-by-date, and creator
breakdowns for the reporting dashboard.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| Every analytics screen. | Gates on "can view transactions" — a separately-declared "can view analytics" permission exists in the setup but isn't checked by any of these routes. | Unclear whether this is UI-nav-only gating or genuinely unused. | `analytics.ts` | Open Q7 |
| A sale is only partially paid. | Summary/cashflow totals count what was actually collected, not the sale's sticker price. | — | `analytics.ts:253-258,359-360` | — |
| A non-admin views the summary. | The response also reports how many private receipts they can't see (zero for anyone who can see everything). | — | `:280-309` | — |
| The cashflow report. | Reads the receipt's stored date with no further timezone conversion, deliberately. | The date is already stored as local, so re-converting it would be wrong. | header comment | — |
| The by-hour check-in/out report. | A stay that hasn't checked out yet is excluded from "out" counts. | Only counts what's actually happened. | `:452-457` | — |
| The by-hour report. | Respects the same privacy rules as the rest of the plugin — a private receipt's activity never leaks into the hourly counts. | — | `:420-429` | — |
| The grouped-by-date route is registered. | Must be registered before the single-receipt route, or the framework tries (and fails) to read "grouped-by-date" as a receipt id. | A real past regression. | `:140-149` | `grouped-by-date.test.ts` |
| The grouped-by-date and day-drilldown views are compared for the same day. | Their totals match exactly, by construction. | — | — | `grouped-by-date.test.ts` |
| The "created by" filter dropdown. | Returns raw staff ids, not names — unlike every other enriched view (list, detail, edit), which does resolve names. | Not explained in code; possibly a performance/scale reason for a filter dropdown. | `:91-93` | Open Q9 |
| A malformed `dateFrom`/`dateTo` is sent to `/summary` or `/cashflow`. | Not validated as a real ISO date before use — unlike `GET /api/transactions` (which silently skips a bad date filter) and `/export` (which rejects one outright). A bad value here reaches the query unguarded. | Inconsistent with the rest of the plugin's date-handling discipline; reads as an oversight rather than a deliberate choice. | `analytics.ts:225-247` (`/summary`), `analytics.ts:332-388` (`/cashflow`) | — (no test found exercising a malformed date on either route) — Open Q17 |

---

## 16. Subscriptions & Renewals

Verified 2026-07-19 · logic changed 2026-06-28 · no tests cited · open: Q11

**What it does:** Groups every day/month-length item a client bought under one package lineage
into a "subscription" view. Offers a one-click renew that continues the same lineage forward.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A client's coverage in a lineage extends more than 14 days out. | Bucketed "active." | — | `subscriptions.ts:69-73` | — |
| A client's coverage lapsed within the last 30 days. | Bucketed "expiring-soon." | — | same | — |
| A client's coverage lapsed more than 30 days ago. | Bucketed "expired." | — | same | — |
| No status filter is given. | Only active + expiring-soon show; expired is opt-in only. | — | `:90-101` | — |
| A package's lineage can't be resolved (catalog down, or a stray id). | The line still shows, grouped under its own synthetic key instead of disappearing. | — | `:161-163` | — |
| Privacy filtering for this view. | Applied at the very first query (line items), not after grouping. | So a private renewal can't leak through an aggregate. | `:103-105` | — |
| A renewal is requested with a missing/invalid account or catalog item. | Rejected. | — | `:293-298` | — |
| A renewal targets a catalog item whose duration isn't day/month. | Rejected — "renewal variant must have day or month duration." | — | `:307-310` | — |
| A renewal is requested for a line item that isn't itself a day/month subscription in this workspace. | Rejected, not found. | Guards against renewing e.g. an hourly rental via a direct API call. | `:321-332` | — |
| Two renewal requests for the same client/lineage arrive close together. | Serialized against each other so they can't both read the same latest-expiry and produce overlapping coverage. | — | `:339-346` | No dedicated integration test found — Open Q11 |
| The prior coverage in the lineage hasn't lapsed yet. | The new period starts exactly where the old one ends (no gap, no overlap). | — | `:385-387` | — |
| The prior coverage already lapsed. | The new period starts from today, not retroactively. | A long-lapsed customer renews from today, not backdated to when they lapsed. | same | — |
| A renewal targets an account from a different workspace. | Rejected. | — | `:373-381` | — |
| A renewal moves a customer to a different tier within the same lineage. | Allowed — an "era upgrade" within a lineage is a legitimate renewal. | — | `:302-303` | — |

---

## 17. Package Eligibility Check

Verified 2026-07-19 · logic changed 2026-07-09 · tests 2026-07-09

**What it does:** Answers whether a client already availed a package lineage before a cutoff
date — for the packages plugin's own promo rules (e.g. "first-time customer" discounts).
Exposed as a cross-plugin lookup, not an HTTP route.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A line item has its own customer set (multi-customer receipt). | That customer is checked first; falls back to the receipt's overall billed-to customer only if the line has none. | — | `has-client-availed-package.ts:56` | — |
| One check in a batch of many is malformed (missing a required field). | Dropped silently — the rest of the batch still runs. | One bad entry shouldn't fail the whole batch. | `:12-14` | `parseAvailedPackageChecks` unit tests |
| The check is run under load with many workspaces' data present. | Never returns a match from another workspace. | — | — | `has-client-availed-package.test.ts` |

---

## 18. Financial Accounts

Verified 2026-07-19 · logic changed 2026-07-11 · tests 2026-07-11 · ⚠ 1 row unverified · open: Q18

**What it does:** Manages the bank/e-wallet/cash/external/capital ledgers a business tracks
money against, their computed running balances, and their logos.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| An account is created or edited. | Type must be one of bank/e-wallet/cash/external/capital; icon must be one of a fixed 10-option list; color must be a valid 6-digit hex code. | — | `routes-accounts.ts:74-99` | `unit/accounts-routes.test.ts` |
| An account's name matches another account in the same workspace (case-insensitive). | Rejected with a message naming the conflicting account — enforced as a hard database rule, not just app logic. | — | `:189-191,231-240` | `unit/accounts-routes.test.ts` |
| An account's balance is computed. | Counts every payment credited to it, plus anything routed the older way. A sale is never counted through both paths at once. Voided entries never count in either. | — | `account-balances.ts:5-27` | Reconciled byte-for-byte against a 300k-row synthetic dataset — `account-balances.reconcile.test.ts` |
| A sale is split across two or more accounts. | Each account is credited only its own share. | This is the entire reason the balance is computed via two separate paths. | module comment | — |
| An account logo is uploaded. | Stored privately, only ever served through an authenticated route that streams the bytes — never a public/signed link. Logos from before this rule existed remain cached publicly until a manual cache flush. | — | `:525-533` | `logo-raw.test.ts` — "returns bytes, never a JSON url/source field" |
| A logo is replaced or removed. | The old file is best-effort cleaned up afterward; cleanup failure never blocks the save. | — | `:554-567,615-626` | `logo-raw.test.ts` (idempotent delete when nothing to clean up) |
| The balance-computation logic is unavailable. | ⚠ unverified. Since payees/balances folded in-process, `fetchBalances` is now a direct DB call wrapped in one flat try/catch (any error → 500) — no distinct soft-degrade-to-dash branch was found at the cited lines. The "shows a dash" behavior, if real, more likely lives client-side (rendering a null/missing balance as "—") than as a server guarantee. | — | `routes-accounts.ts` (no distinct branch found at `:397-399` as described) | — |
| A soft-deleted account is restored. | Uses the same permission as editing — there's no separate "restore" permission by design. | — | `:264-269` | — |

---

## 19. Payees

Verified 2026-07-19 · logic changed 2026-07-06 · no tests cited · open: Q12

**What it does:** The vendor/customer directory used when recording manual income/expense
entries.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A payee's kind is set to something other than vendor/customer/both on create. | Silently defaults to "vendor" rather than being rejected — inconsistent with financial accounts, which rejects bad input outright. | Not explained in code — flagged as a possible intent gap. | `routes-payees.ts:71` | Open Q12 |
| A payee's name matches another one in the same workspace with the same kind (case-insensitive). | Rejected — "A payee with this name and kind already exists." A vendor and a customer CAN share the same name, since kind differs. | — | `:37-44,75-78` | — |
| The payee list is filtered by kind (vendor or customer). | Payees marked "both" are always included alongside the exact match. | A kind filter shouldn't hide a dual-purpose payee. | `:60-64` | — |
| A payee is deleted. | Soft-deleted only; the default list shows active ones. | — | — | — |

---

## 20. Multi-Tenant Isolation Guarantee

Verified 2026-07-19 · logic changed 2026-07-16 · tests 2026-07-16 · open: Q13, Q16

**What it does:** The cross-cutting promise underneath every feature above: one business's data
never touches another's. Checked twice — once in application logic, once at the database level.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| Every list/read/write query in this plugin. | Explicitly filters to the caller's own workspace, in addition to (not instead of) a database-level second wall. | Two independent layers — a bug in one doesn't expose another business's data. | — | — |
| Workspace A tries to read, update, or delete workspace B's receipt/payment/account, including via a raw internal query path. | Fails at every layer. Reads return nothing, writes affect zero rows, and even a deliberately-forged workspace id on an insert lands in the caller's own workspace. | — | — | `transactions.leak.test.ts`, `transaction-payments.leak.test.ts`, `financial-accounts.leak.test.ts` |
| A receipt is checked for cross-plugin eligibility (e.g. "has this client availed X before"). | Independently confirmed to never leak a match from another workspace, since this path is a service call from another plugin, not a normal HTTP route. | — | — | `has-client-availed-package.test.ts` |
| A second customer group tries to be marked "the payer" on a receipt that already has one. | Rejected at the database level, not just by app logic. | A second, independent wall behind the app-level check. | DB migration `20260716000000_add_transaction_customer_groups_single_payer_index.ts` | `transaction-customer-groups-single-payer-index.test.ts` — confirmed by direct read to contain the assertion `rejects a second is_payer=TRUE customer group on the same transaction with 23505` |
| Every route in this domain. | Checks a specific permission for that exact action — there's no single blanket "can use this plugin" switch. | — | — | — |
| The payee directory specifically. | Very likely covered by the same database-level wall as receipts/accounts (same underlying pattern), but no dedicated leak test was located to confirm it directly. | — | — | Open Q13 |
| The subcategories taxonomy (`accounts.transaction_subcategories`). | The one deliberate exception to this whole section: it is NOT workspace-scoped by design — no `workspace_id` column, no RLS policy, shared across every business on the platform. See Feature 13. | Deliberate per the migration's own comment, but worth a business-owner sign-off given it contradicts this section's framing everywhere else. | migration comment "Org-global taxonomy" | — (nothing to isolate by design; see Open Q16) |

---

## 21. Outstanding Balances

Verified 2026-07-19 · logic changed 2026-07-06 · no tests cited · open: Q4

**What it does:** Answers "who still owes us money" — the list front-desk/collections staff use
to chase unpaid or partially-paid receipts. Route: `GET /outstanding` — missing from the
original mapping pass, added during verification.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| The outstanding list is requested. | Only sale receipts with a genuine unpaid balance show — `status != voided`, `amount > 0`, and total paid strictly less than the amount. | A voided or fully-paid receipt has nothing left to collect. | `charge.ts:32-67` | — |
| Total paid per receipt is computed for the list. | Done as one `GROUP BY` aggregate join across all rows at once, not a per-row lookup. | Explicit performance choice (comment in code) — this list can be large. | `charge.ts:49-64` | — |
| A receipt's items are summarized for the list. | Built as quantity × (package name, or the raw line description if no package resolves), joined with " · ". | — | `charge.ts:70-101` | — |
| The billed-to client's name is shown. | Resolved via the clients RPC; gracefully omitted (not erroring the whole list) if that plugin is unreachable. | Matches the same graceful-degradation pattern used everywhere else names are enriched cross-plugin. | `charge.ts:102-112` | — |
| Privacy and ordering. | Same `privacyClause` as every other receipt view; ordered by transaction date then id, most recent first. | Keeps this view from ever disagreeing with what the list/detail screens already enforce. | `charge.ts:32-67` | — |

## 22. CSV Export

Verified 2026-07-19 · logic changed 2026-07-08 · tests 2026-07-02

**What it does:** Lets staff download a filtered slice of receipts as a CSV report — a per-day
summary or a full detailed row-per-receipt export — via an async background job with progress
polling. Routes: `POST /export`, `GET /export/:jobId/progress`, `GET /export/:jobId/download`,
`GET /export` (recent jobs). Missing from the original mapping pass; added during verification.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| An export is requested. | Requires `transactions.view`, not create/edit — exporting is read-only. `dateFrom`/`dateTo` must be valid ISO dates with `dateFrom <= dateTo`, and the range can't exceed 730 days. | The 730-day cap is a real server-side limit, not just a UI courtesy — a caller that bypasses the UI still can't request an unbounded range. | `export.ts:338-364` | `export-flow.test.ts` — "rejects an inverted date range" |
| Attachment storage isn't configured. | Export request rejected with 503. | No file storage, no export possible. | `export.ts:338-364` | — |
| A cell in the export would start with `=`, `+`, `-`, `@`, a tab, or a CR. | Prefixed with a single quote before writing. | Defends against CSV/spreadsheet formula injection — a malicious description could otherwise execute a formula when the file is opened in Excel/Sheets. | `export.ts:50-55` | — |
| The export runs. | Fire-and-forget background job; writes progress to its own job row as it goes; excludes voided rows and applies the requester's own privacy filter — an export can never contain a row the requester couldn't already see in the list. | An export must carry the exact same access boundary as the screen it's exported from. | `export.ts:19-21,88-139,143-155` | — |
| The plugin restarts mid-export. | The job row is left stuck "running" until it naturally expires — no partial file is ever served, since download gates strictly on `status = 'done'`. | A half-written CSV must never reach a user. | `export.ts:88-139` | — |
| The terminal "done" update fails after the file is already uploaded to storage. | The uploaded file is deleted so nothing orphaned/unreferenceable is left behind. | Mirrors the same orphan-cleanup discipline used for attachments and logos. | `export.ts:116-128` | — |
| Progress is polled while a job runs. | Server-sent events, polling the job row every 600ms; terminal states are done/error/expired; self-times-out after 5 minutes with "Export timed out — please retry." | — | `export.ts:398-431,451-463,469` | — |
| The file is downloaded. | Streamed from private storage through this authenticated route — never a public URL — mirroring the attachment `/raw` pattern; 404 if the job is missing or its row has expired, 409 if not yet done. | Same never-a-public-link discipline as attachments/logos. | `export.ts:480-510` | `export-flow.test.ts` — "404s a download for an unknown job" |
| A finished export is downloaded. | Includes every row the requester could see in the list, batch-resolving account/payee/user names once for the whole file (blank cell, not an error, if a peer plugin is unreachable). | — | `export.ts:204-256,258-278` | `export-flow.test.ts` — "exports a detailed CSV that includes a freshly-created row" |

## 23. Live Board Updates

Verified 2026-07-19 · logic changed 2026-07-06 · no tests cited

**What it does:** Lets the front-desk board refresh itself when another terminal changes a
receipt — charge, void, extend, forfeit — without a manual reload. Route:
`GET /api/transaction-line-items/events` (server-sent events). Missing from the original
mapping pass; added during verification.

| Scenario | Business rule | Why | Enforced at | Pinned by test |
|---|---|---|---|---|
| A board subscribes to updates. | Server-sent-events stream, scoped per workspace; sends an initial "hello" with the current board version, then a heartbeat every 25 seconds (waking early on any real change). | The 25s cadence sits under nginx's 60s default proxy timeout, so the connection is never silently dropped by the edge for looking idle. | `line-items-events.ts:18-48` | — |
| Any mutation bumps the board (charge, void, extend, forfeit, etc.). | Every open subscriber for that workspace is notified with a single "board-changed" event; several bumps that land between reads coalesce into one event, never a flood. | The client only needs to know "something changed, go refetch" — not what. | `board-events.ts:9-21` | — |
| A line item's booked end time passes (`ends_at < NOW()`), with no staff action taken. | This does NOT bump the board version — a purely time-driven state change is invisible to the SSE stream. | The event system only tracks writes; clients must separately poll for wall-clock expiry (e.g. a session quietly going overdue). | `board-events.ts:6-7` | — |
| The plugin process restarts, or runs as more than one pm2 instance. | Subscribers are an in-process `Map` — a version bump on one process never reaches subscribers connected to a different process. | Documented single-process assumption; a future multi-instance deploy of this plugin would need a cross-process fanout mechanism this doesn't have. | `board-events.ts:9-21` | — |

## Deliberately out of scope

Behaviors the blind code/test inventories surfaced that are real, but are internal plumbing with
no business meaning of their own — each justified rather than silently dropped:

- **Route-registration ordering comments** (`transactions-counter-patch.ts`, `payments.ts`,
  `transactions-cart-edit.ts` all note they're registered after/before specific other routes "to
  preserve original Express match order"). This is HTTP-framework routing mechanics — as long as
  the order is correct, no user-visible behavior differs. The one case where a wrong order would
  be user-visible (`/grouped-by-date` vs `/:id`) is already documented in Feature 15 as "a real
  regression"; the rest are the same category of concern with no known incident behind them.
- **Two `dead return;` statements** after an already-executed `return c.json(...)` in
  `charge.ts:154-158` and `analytics.ts:54-76`. Unreachable code, confirmed harmless — no
  behavior difference with or without it.
- **`lib/peers.ts`'s `findAccountsByIds` deliberately excluded from the plugin manifest's
  `requires` list.** This is a plugin-loading/dependency-declaration mechanic (so the loader
  never skips this plugin over an optional peer being absent) — the resulting business behavior
  ("another plugin unreachable" degrades gracefully) is already Feature 9's "peer plugin
  unreachable" row; the manifest detail itself is packaging plumbing, not a business rule.
- **`lib/create-transaction.ts`'s `updated_by = created_by` at insert, and its
  `ON CONFLICT DO NOTHING` dedup on visibility-share inserts.** Internal write mechanics with no
  business outcome beyond what Feature 12 already documents about sharing lists.
- **`lib/active-line-summary.ts`'s formatting details** (em dash vs. hyphen, the
  already-prefixed-description double-labeling guard). Cosmetic string formatting, not a
  business rule — the underlying "recompute the title from active lines" rule is already
  documented in Features 9/10.
- **`theme-contribution.test.ts`'s WCAG-contrast and token-shape assertions** for the plugin's
  contributed UI theme. This validates a color palette, not a transactional business rule — no
  connection to receipts, payments, or any feature in this document.
- **Test-hygiene observations from the blind test inventory** (e.g.
  `cart-edit-new-group-position.test.ts` actually exercising a lower-level helper rather than
  the HTTP route its filename suggests; `transaction-customer-groups-single-payer-index.test.ts`
  being a single thin assertion). These are notes about the test suite's own naming/coverage
  confidence, not product behavior — no scenario row would represent them accurately; flagged
  here so they aren't silently dropped.

---

## Open questions

These are the exact places the two people who mapped this plugin could not confirm intent or
coverage from the code and tests alone. Each one is a candidate for a quick yes/no from
whoever owns the business rule.

1. **Voucher usage counting is a documented no-op.** When a discount code is used at checkout, the code that's supposed to record "this code was used" is a stub — the vouchers add-on doesn't yet expose a way to record it. Anyone relying on voucher redemption counts should confirm this hasn't quietly been fixed since. (`charge.ts:140-151`)
2. **The "code not found vs. add-on not installed" disambiguation at checkout has no dedicated test.** The logic exists and is commented, but no automated test proves it behaves correctly for the main checkout flow (only for the manual-discount path). (`run-charge.ts:109-121`)
3. **Reassigning a customer group's billed-to client (the counter quick-edit) has no dedicated test file.** The "sync the receipt's own billed-to name when the payer group changes" behavior and the optional-display-name handling are pinned only by code comments. (`transactions-counter-patch.ts:186-275`)
4. **The outstanding-balance view's package summary and client-name fields aren't directly tested**, only its balance numbers are, via the forfeit-flow test.
5. **A referenced design document (`SAME-TX-EDIT-BRIEF.md`) explaining the cart-edit route's original rationale was not located/read** during this mapping pass — worth reading directly if deeper "why" is ever needed beyond what's in code comments.
6. **The "private receipt returns not-found, not forbidden" rule on the detail view has no test found that asserts it directly** (only inferred from code, by analogy to the list's version of the same rule).
7. **A "can view analytics" permission is declared in the plugin's setup but no analytics screen actually checks it** — every analytics route checks "can view transactions" instead. Could be intentional (gating only the nav link to the Analytics screen) or dead configuration.
8. **Two different actions both mark a receipt "voided"** — a plain delete (no reason required, nothing logged) and an explicit void (reason required, logged). No comment explains why both exist with different guarantees; possibly legacy API surface.
9. **The "who created this" filter dropdown returns raw staff IDs instead of names**, unlike every other screen in this plugin, which resolves names directly. Not explained — may be a deliberate performance choice for a dropdown that's populated differently by the interface.
10. **The withholding-tax amount formula — corrected during verification: this is NOT a live accounting risk.** `round(amount × rate) / 100` was re-derived algebraically and confirmed identical to the standard round-to-cents formula ("divide the rate by 100 first, then round") — multiplication and division associate, so the two orders always produce the same result in exact arithmetic. Still no isolated unit test covers the formula alone, so this stays open only as a "worth a test" item, not a "worth an accounting sanity check" item. (`transactions-core.ts:394-405`)
11. **Subscription renewal has no dedicated integration test** for its three trickiest behaviors: the concurrency lock, "start from where coverage left off vs. start from today," and rejecting a renewal against another workspace's account. All three are well-commented in code but not directly pinned by a test in this snapshot.
12. **An invalid "kind" on a new payee silently becomes "vendor"** rather than being rejected — inconsistent with financial accounts, which rejects bad input outright. May be intentional leniency for a lower-stakes field, may be an oversight.
13. **No dedicated test was found confirming the payee directory has the same cross-workspace protection** that receipts, payments, and accounts each have their own test file proving.
14. **Three receipt-related tables (attachment records, and the two sharing-list tables) have no workspace column of their own** and rely entirely on joining through the parent receipt for isolation. Worth confirming this is on the documented list of intentional exceptions rather than an oversight. (A fourth table has the same shape but a different reason — see Q15.)
15. **NEW — the subcategories taxonomy (`accounts.transaction_subcategories`) has no `workspace_id` column at all, and shares one list across every workspace on the platform**, not just this one plugin's usual "no isolation column, joins through the parent" pattern (that's Q14) — this table has no parent to join through; it's a genuinely global, cross-tenant-shared list. The migration comment calls this deliberate ("org-global taxonomy"), but it directly contradicts the isolation promise in Feature 20 and is worth an explicit business-owner sign-off, not just an engineering shrug. (Feature 13, Feature 20)
16. **NEW — a soft-deleted subcategory can still be assigned to a transaction.** `validateSubcategory` has no `is_active` filter, unlike the dropdown's `listSubcategories`. Every other soft-delete in this plugin (payees, financial accounts) blocks the retired value from being reused; this one doesn't. Confirm whether that inconsistency is intentional. (`lib/transaction-subcategories.ts:77-85`)
17. **NEW — `/summary` and `/cashflow` don't validate `dateFrom`/`dateTo` as real ISO dates**, unlike `GET /api/transactions` (silently skips a bad filter) and `/export` (rejects outright). Confirm whether an unguarded malformed date is safe here (e.g. the query tolerates it) or should get the same guard the other two routes have. (`analytics.ts:225-247,332-388`)
18. **NEW — Feature 18's "balance computation unavailable → shows a dash" row could not be verified against the server code as described** (no distinct soft-degrade branch found in `routes-accounts.ts`) and needs a follow-up check against the client-side rendering code instead. Flagged inline as `⚠ unverified` in Feature 18 pending that check.
