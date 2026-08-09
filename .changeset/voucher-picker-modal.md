---
"@kahitsan/ksui": minor
---

VoucherPicker: open a dialog instead of an anchored dropdown

The trigger now opens a centered modal with a code search box, roomier rows,
and a per-voucher reason explaining why an ineligible voucher can't be applied
(below minimum, wrong items, expired, not yet started, inactive) instead of an
unexplained greyed-out row. `aria-haspopup` moves from `listbox` to `dialog`;
existing test ids are unchanged.
