---
"@kahitsan/ksui": minor
---

VoucherPicker: show redemptions used against the limit, and block exhausted codes

Rows now read "3/10 used" alongside the discount and expiry, tinted amber once
the remaining redemptions run low. A code with no `usage_limit_total` is
unlimited and shows nothing. A fully-redeemed code moves to "Not applicable"
with a "Fully redeemed" reason instead of staying selectable — the server
already rejects it, so it previously failed only at charge time.
