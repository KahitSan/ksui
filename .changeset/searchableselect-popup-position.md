---
"@kahitsan/ksui": patch
---

SearchableSelect: fix popup positioning so it hugs the trigger. The popup no longer flips far above the trigger when there is usable space below, and when it does flip up it anchors by its bottom edge to sit right above the trigger instead of floating a fixed POPUP_MAX_HEIGHT away.
