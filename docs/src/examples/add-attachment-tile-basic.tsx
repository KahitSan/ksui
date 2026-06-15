// example-start
import { createSignal } from "solid-js";
import { AddAttachmentTile } from "@kahitsan/ksui";

export default function AddAttachmentTileBasic() {
  // In the app this dashed tile sits in an attachments row. The tile is its
  // own trigger: tap it to open the Camera / Image-or-file menu, so there is
  // no extra button to add here.
  const [uploading, setUploading] = createSignal(false);
  const [last, setLast] = createSignal<string>("nothing yet");
  const flash = (what: string) => {
    setLast(what);
    setUploading(true);
    setTimeout(() => setUploading(false), 1200);
  };
  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1rem",
      }}
    >
      <div style={{ width: "96px" }}>
        <AddAttachmentTile
          uploading={uploading()}
          onPickFile={() => flash("picked a file")}
          onPickCamera={() => flash("opened camera")}
        />
      </div>
      <p class="text-sm text-zinc-400" style={{ margin: 0 }}>
        Last action: <span class="text-zinc-200">{last()}</span>
      </p>
    </div>
  );
}
