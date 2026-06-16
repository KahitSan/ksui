---
"@kahitsan/ksui": patch
---

Add an optional `closeOnSelect` prop to ComboBox multi mode. When set, the results popup closes after each add/create (the input keeps focus and reopens on the next keystroke) instead of staying open for rapid multi-add. Lets a consumer whose popup overlays a click target below it — e.g. the POS package grid — avoid the lingering popup eating the next click.
