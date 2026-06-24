---
"@kahitsan/ksui": minor
---

Add three spec-driven UI runtimes for the plugin platform (Vision §8/§9/§11):

- **FileField (U6)** — a declarative file/media field whose value is an opaque asset handle (`{ id, name, mime, size }`). Storage-agnostic: the host injects `onUpload(file) => Promise<handle>` and `presignUrl(handle) => Promise<url>`; ksui models only the pending/uploading/done/failed state machine, drag-drop + click-to-pick, and an image preview that degrades to a broken-thumbnail fallback (never throws) when a presign rejects.
- **FlowRunner (U7)** — a client renderer for a server-driven node graph. The host injects `advance(state, input) => Promise<nextNode>`; the client only renders UI-effect nodes (form/display/choice/message/terminal) and POSTs each step. All authority/data/branching stays server-side — the client never decides the graph. Ships `utils/flow.ts` with the `FlowNode` discriminated union and pure step helpers.
- **CustomRenderer + renderer registry (U8)** — a typed, in-process registry mapping a renderer `id` → a component with declared `consumes`/`emits`, plus a `CustomRenderer` that validates props against `consumes` and falls back safely (with a warning) on an unknown id or a mismatch. No `eval`, no remote code — registry holds build-time, in-process components only (supply-chain trust, not a sandbox). Undeclared emits are dropped so a renderer cannot forge an interaction.

Purely additive; existing exports are unaffected.
