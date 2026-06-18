---
"@kahitsan/ksui": minor
---

Add Tailwind CSS plugin for automatic utility class safelisting

Ship `@kahitsan/ksui/tailwind` — a Tailwind plugin that safelists every
utility class ksui components reference (button intents, DataTable styles,
Modal, StatusPill, FormErrorBanner, CopyButton, etc.). Without the plugin,
Tailwind may purge these classes from node_modules, causing missing
backgrounds or borders on Button, DataTable, DatePicker, and other components.

Setup:
- Tailwind v3: `plugins: [require("@kahitsan/ksui/tailwind")]`
- Tailwind v4: `@plugin "@kahitsan/ksui/tailwind";`
