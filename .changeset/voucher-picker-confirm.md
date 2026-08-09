---
"@kahitsan/ksui": minor
---

VoucherPicker: confirm the pick before it applies

Tapping a row now stages it — the choice reaches `onChange` only when Confirm is
pressed, so a mis-tap can be corrected in place and Cancel discards the whole
edit. The footer names the staged voucher and its discount, the button reads
Apply / Change / Remove to match what pressing it will do, and it stays disabled
until the staged pick actually differs from what the cart already has. Re-tapping
the staged row unstages it. Also stops the trigger repeating the peso figure for
a fixed-amount voucher.
