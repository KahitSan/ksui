---
"@kahitsan/ksui": minor
---

New declarative route/form builder layer over ResourceUiSpec: `defineRoute`, `defineForm`, `col`, `Cell.*`, `table`, `action`, `field.*`, `setting.*`, and `routeToResourceSpec` which lowers a built RouteSpec to the exact ResourceUiSpec a hand-authored spec would produce (throwing on unwired config instead of silently dropping it). ResourcePage remains the single render engine.
