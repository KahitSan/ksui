// example-start
import { createSignal, For } from "solid-js";
import { Button } from "@kserp/host-ui";
import { ExistingAttachmentTile, type ExistingAttachment } from "@kahitsan/ksui";

const seed: ExistingAttachment[] = [
  {
    id: 1,
    file_name: "receipt.jpg",
    mime_type: "image/jpeg",
    s3_link: "https://picsum.photos/seed/receipt/200/200",
  },
  {
    id: 2,
    file_name: "contract.pdf",
    mime_type: "application/pdf",
    s3_link: "https://example.com/files/contract.pdf",
  },
  {
    id: 3,
    file_name: "old-scan.png",
    mime_type: "image/png",
    s3_link: null,
  },
];

export default function ExistingAttachmentTileBasic() {
  // We render the row the way it appears inside a transaction or voucher
  // form. Each tile carries its own remove button when onDelete is passed, which pops the host
  // confirm dialog before it calls back. A host Button restores the demo so you
  // can try the remove flow again.
  const [attachments, setAttachments] = createSignal(seed);

  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1.25rem",
      }}
    >
      <div style={{ display: "flex", gap: "1rem", "flex-wrap": "wrap", "align-items": "flex-start" }}>
        <For each={attachments()}>
          {(att) => (
            <ExistingAttachmentTile
              attachment={att}
              testId={`att-${att.id}`}
              onDelete={async (id) => {
                setAttachments((list) => list.filter((a) => a.id !== id));
              }}
            />
          )}
        </For>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", "align-items": "center" }}>
        <Button
          intent="secondary"
          variant="ghost"
          disabled={attachments().length === seed.length}
          onClick={() => setAttachments(seed)}
        >
          Restore sample attachments
        </Button>
        <span class="text-zinc-400 text-sm">
          An image previews, a PDF falls back to a paperclip, and a broken link shows Unavailable.
        </span>
      </div>
    </div>
  );
}
