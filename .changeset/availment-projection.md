---
"@kahitsan/kplugin_finance": minor
---

Counter board reads now use a precomputed availment projection, replacing the slow recursive chain query with bounded, indexed lookups. Singleton availments and mixed cards with voided package groups render correctly, and the board refreshes only after the projection has caught up with the write.
