// Vendored into plugin remotes.
// Dashed "Add" tile with a small Camera / Image-or-file popover menu.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import Plus from "lucide-solid/icons/plus";
import Camera from "lucide-solid/icons/camera";
import FileIcon from "lucide-solid/icons/file";

interface Props {
  uploading: boolean;
  onPickFile: () => void;
  onPickCamera: () => void;
}

export default function AddAttachmentTile(props: Props) {
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal({ top: 0, left: 0 });
  let btn: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;

  const place = () => {
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setPos({ top: r.bottom + 8, left: r.left });
  };

  onMount(() => {
    const handler = (e: MouseEvent) => {
      if (btn && !btn.contains(e.target as Node) && menu && !menu.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", handler);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    onCleanup(() => {
      document.removeEventListener("click", handler);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    });
  });

  return (
    <div class="shrink-0">
      <button
        ref={btn}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (props.uploading) return;
          place();
          setOpen(!open());
        }}
        disabled={props.uploading}
        class="w-24 h-24 flex flex-col items-center justify-center gap-1 border border-dashed border-zinc-700 bg-zinc-800/30 text-zinc-400 hover:bg-zinc-800/60 hover:border-amber-500/40 hover:text-amber-400 active:bg-zinc-800/80 transition-colors ks-hud-clip-top-left-bottom-right cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Add attachment"
      >
        <Plus size={22} />
        <span class="text-[10px] uppercase tracking-wider">{props.uploading ? "Uploading" : "Add"}</span>
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={menu}
            style={{ top: `${pos().top}px`, left: `${pos().left}px` }}
            class="fixed z-[60] min-w-[160px] rounded-lg border border-zinc-600 bg-zinc-800 shadow-2xl p-1 ks-hud-clip-top-left-bottom-right"
          >
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 rounded cursor-pointer"
              onClick={() => {
                setOpen(false);
                props.onPickCamera();
              }}
            >
              <Camera size={16} />
              <span>Camera</span>
            </button>
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 rounded cursor-pointer"
              onClick={() => {
                setOpen(false);
                props.onPickFile();
              }}
            >
              <FileIcon size={16} />
              <span>Image or file</span>
            </button>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
