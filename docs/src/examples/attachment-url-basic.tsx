// example-start
import { For } from "solid-js";
import { attachmentUrl, isResolvableAttachment } from "@kahitsan/ksui";

// attachmentUrl + isResolvableAttachment are pure helpers, so there is no app
// trigger to wire up. Instead we show what each stored s3_link resolves to,
// the way a render site would see it.
export default function AttachmentUrlBasic() {
  const inputs = ["https://cdn.example.com/r.pdf", "ftp://example.com/x", "javascript:void(0)", null];
  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "0.75rem",
      }}
    >
      <For each={inputs}>
        {(input) => {
          const url = attachmentUrl(input);
          const resolvable = isResolvableAttachment(input);
          return (
            <div
              class="text-zinc-200"
              style={{
                display: "grid",
                "grid-template-columns": "minmax(0, 1fr) minmax(0, 1fr) auto",
                gap: "0.75rem",
                "align-items": "center",
                "font-size": "0.85rem",
              }}
            >
              <code class="text-zinc-400">{String(input)}</code>
              <code class="text-zinc-200">{url || "(empty)"}</code>
              <span class={resolvable ? "text-emerald-400" : "text-rose-400"}>
                {resolvable ? "resolvable" : "blocked"}
              </span>
            </div>
          );
        }}
      </For>
    </div>
  );
}
