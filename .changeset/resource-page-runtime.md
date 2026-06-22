---
"@kahitsan/ksui": minor
---

Add `ResourcePage` — a spec-driven default-datatable runtime. A base plugin's list/create/edit/archive page is expressed as a declarative `ResourceUiSpec` (columns with render hints, form fields, filters, labels) and rendered through `ResourcePage`, which composes the existing DataTable + Modal + FormField + StatusPill + SegmentedFilter + DetailRow primitives. Host primitives (PageShell, PageShareButton, and the workspace/permission hooks) are injected via a `host` prop, so the library stays standalone — it never imports the host UI kit. Also exports the pure spec helpers (`buildListQuery`, `validateForm`, `formToBody`, `emptyFormValues`, `rowToFormValues`, `endpoints`, …) and the `ResourceUiSpec` type vocabulary. Proven byte-for-behavior against the hand-written payees page.
