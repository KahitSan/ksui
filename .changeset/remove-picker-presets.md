---
"@kahitsan/ksui": minor
---

Remove the ClientPicker and PayeePicker preset components. The library now ships a single picker — EntityPicker — and consumers wire the payee/client endpoint (search / onCreate / icon / noun) at the call site. The PayeeOption, PayeeKind, and ClientOption option types remain exported (decoupled into picker-types) so existing type imports keep working.
