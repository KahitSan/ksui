---
"@kahitsan/ksui": patch
---

Fix a flicker when adding an item in ComboBox multi mode. The results popup rendered its list from freshly-built wrapper objects each pass, so the `<For>` could not reconcile and tore the whole list down on every change; it now iterates the stable search results and reconciles by reference. With `closeOnSelect`, the popup also now closes before the value changes, so the about-to-be-hidden list no longer re-renders in view.
