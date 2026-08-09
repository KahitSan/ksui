---
"@kahitsan/ksui": minor
---

VoucherPicker: page the list in on scroll, show expiry, highlight the search match

The picker fetched the whole table (`limit=200`) and filtered in the browser.
It now requests 25 at a time and pulls the next page when the end of the list
scrolls into view, and the search box is debounced into the server's `search`
param so a match is found across every page rather than only the rows already
downloaded. Rows carry the voucher's expiry ("Expires in 3 days", "Expires
2026-09-01"), tinted with a clock icon inside the last week, and the matched
substring is highlighted with the shared `highlightMatch` helper. Date fields
that arrive as full timestamps are read as their calendar day.
