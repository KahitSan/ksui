---
"@kahitsan/ksui": patch
---

Harden `ResourcePage` against an inline `host` prop. `headerActions` is now a render function (`() => JSX.Element`) instead of a pre-created element, and the component reads `props.host` once at setup. Previously, passing an inline `host={{ ... headerActions: <X/> }}` literal caused the action element to re-instantiate outside the render scope on every `props.host.*` access (e.g. during a save), throwing if that element used render-scoped context. Consumers now pass `headerActions: () => <X/>`.
