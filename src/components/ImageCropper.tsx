// ImageCropper presents a square (1:1) crop tool over an uploaded image file.
//
// The user drags inside the box to reposition the selection and drags a
// corner to resize it. On Apply, the selected region is rendered to a canvas
// at the requested output size and handed back as a WebP Blob.
//
// The widget is dependency-free beyond the host kit: it uses the host's
// Modal + Button (provided by the consumer via "@kserp/host-ui"), solid-js,
// and a single lucide icon.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Modal, Button } from "@kserp/host-ui";
import X from "lucide-solid/icons/x";

interface ImageCropperProps {
  file: File;
  outputSize?: number;
  onCancel: () => void;
  onApply: (blob: Blob) => void;
  busy?: boolean;
  title?: string;
}

const MAX_DISPLAY_W = 480;
const MAX_DISPLAY_H = 360;
const MIN_SEL = 48;

type DragMode = "move" | "tl" | "tr" | "bl" | "br";

interface ImageState {
  el: HTMLImageElement;
  naturalWidth: number;
  naturalHeight: number;
  displayedWidth: number;
  displayedHeight: number;
  scale: number;
}

export default function ImageCropper(props: ImageCropperProps) {
  const outputSize = () => props.outputSize ?? 512;
  const [imageUrl, setImageUrl] = createSignal<string>("");
  const [image, setImage] = createSignal<ImageState | null>(null);
  const [sel, setSel] = createSignal({ x: 0, y: 0, size: 0 });
  const [loadError, setLoadError] = createSignal("");

  let dragMode: DragMode | null = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let selStart = { x: 0, y: 0, size: 0 };

  onMount(() => {
    const url = URL.createObjectURL(props.file);
    setImageUrl(url);

    const el = new Image();
    el.onload = () => {
      const scale = Math.min(MAX_DISPLAY_W / el.naturalWidth, MAX_DISPLAY_H / el.naturalHeight, 1);
      const displayedWidth = Math.round(el.naturalWidth * scale);
      const displayedHeight = Math.round(el.naturalHeight * scale);
      const maxSize = Math.min(displayedWidth, displayedHeight);
      const initialSize = Math.round(maxSize * 0.9);
      setImage({ el, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, displayedWidth, displayedHeight, scale });
      setSel({
        x: Math.round((displayedWidth - initialSize) / 2),
        y: Math.round((displayedHeight - initialSize) / 2),
        size: initialSize,
      });
    };
    el.onerror = () => setLoadError("Could not load this image. Try a different file.");
    el.src = url;
    onCleanup(() => URL.revokeObjectURL(url));
  });

  function clampMove(nextX: number, nextY: number) {
    const img = image();
    if (!img) return { x: 0, y: 0 };
    const s = sel().size;
    return {
      x: Math.max(0, Math.min(img.displayedWidth - s, nextX)),
      y: Math.max(0, Math.min(img.displayedHeight - s, nextY)),
    };
  }

  function handlePointerDown(mode: DragMode) {
    return (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragMode = mode;
      pointerStartX = e.clientX;
      pointerStartY = e.clientY;
      selStart = { ...sel() };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragMode) return;
    const img = image();
    if (!img) return;
    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;

    if (dragMode === "move") {
      const next = clampMove(selStart.x + dx, selStart.y + dy);
      setSel({ x: next.x, y: next.y, size: selStart.size });
      return;
    }

    let newSize = selStart.size;
    let newX = selStart.x;
    let newY = selStart.y;

    if (dragMode === "br") {
      const delta = Math.max(dx, dy);
      const limit = Math.min(img.displayedWidth - selStart.x, img.displayedHeight - selStart.y);
      newSize = Math.max(MIN_SEL, Math.min(limit, selStart.size + delta));
    } else if (dragMode === "bl") {
      const delta = Math.max(-dx, dy);
      const anchorX = selStart.x + selStart.size;
      const limit = Math.min(anchorX, img.displayedHeight - selStart.y);
      newSize = Math.max(MIN_SEL, Math.min(limit, selStart.size + delta));
      newX = anchorX - newSize;
    } else if (dragMode === "tr") {
      const delta = Math.max(dx, -dy);
      const anchorY = selStart.y + selStart.size;
      const limit = Math.min(img.displayedWidth - selStart.x, anchorY);
      newSize = Math.max(MIN_SEL, Math.min(limit, selStart.size + delta));
      newY = anchorY - newSize;
    } else if (dragMode === "tl") {
      const delta = Math.max(-dx, -dy);
      const anchorX = selStart.x + selStart.size;
      const anchorY = selStart.y + selStart.size;
      const limit = Math.min(anchorX, anchorY);
      newSize = Math.max(MIN_SEL, Math.min(limit, selStart.size + delta));
      newX = anchorX - newSize;
      newY = anchorY - newSize;
    }

    setSel({ x: newX, y: newY, size: newSize });
  }

  function handlePointerUp(e: PointerEvent) {
    if (!dragMode) return;
    dragMode = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  function recenter() {
    const img = image();
    if (!img) return;
    const size = Math.round(Math.min(img.displayedWidth, img.displayedHeight) * 0.9);
    setSel({
      x: Math.round((img.displayedWidth - size) / 2),
      y: Math.round((img.displayedHeight - size) / 2),
      size,
    });
  }

  async function handleApply() {
    const img = image();
    if (!img) return;
    const sx = sel().x / img.scale;
    const sy = sel().y / img.scale;
    const ssize = sel().size / img.scale;
    const out = outputSize();
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setLoadError("Your browser couldn't open a 2D canvas to render the crop."); return; }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.el, sx, sy, ssize, ssize, 0, 0, out, out);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    if (!blob) {
      setLoadError("Couldn't encode the cropped image. Try a smaller source image or a different file.");
      return;
    }
    props.onApply(blob);
  }

  const maskTop = () => ({ top: "0px", left: "0px", width: `${image()?.displayedWidth ?? 0}px`, height: `${sel().y}px` });
  const maskBottom = () => ({ top: `${sel().y + sel().size}px`, left: "0px", width: `${image()?.displayedWidth ?? 0}px`, height: `${(image()?.displayedHeight ?? 0) - sel().y - sel().size}px` });
  const maskLeft = () => ({ top: `${sel().y}px`, left: "0px", width: `${sel().x}px`, height: `${sel().size}px` });
  const maskRight = () => ({ top: `${sel().y}px`, left: `${sel().x + sel().size}px`, width: `${(image()?.displayedWidth ?? 0) - sel().x - sel().size}px`, height: `${sel().size}px` });
  const selectionStyle = () => ({ left: `${sel().x}px`, top: `${sel().y}px`, width: `${sel().size}px`, height: `${sel().size}px` });
  const sourceCropSizePx = () => {
    const img = image();
    if (!img) return 0;
    return Math.round(sel().size / img.scale);
  };

  return (
    <Modal onClose={props.onCancel} size="md">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-zinc-100">{props.title ?? "Crop logo"}</h2>
        <button
          type="button"
          onClick={props.onCancel}
          class="text-zinc-500 hover:text-zinc-300 cursor-pointer"
          disabled={props.busy}
          aria-label="Close cropper"
        >
          <X size={20} />
        </button>
      </div>

      <Show when={loadError()}>
        <div class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400 mb-3">
          {loadError()}
        </div>
      </Show>

      <p class="text-xs text-zinc-500 mb-3">
        Drag inside the box to reposition. Drag a corner to resize. The result is saved as a 1:1 square.
      </p>

      <div class="flex justify-center mb-4">
        <Show when={image()}>
          {(img) => (
            <div
              class="relative select-none touch-none bg-zinc-900 rounded-lg overflow-hidden"
              style={{ width: `${img().displayedWidth}px`, height: `${img().displayedHeight}px` }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <img src={imageUrl()} alt="" draggable={false} class="absolute inset-0 w-full h-full pointer-events-none" />
              <div class="absolute bg-black/60 pointer-events-none" style={maskTop()} />
              <div class="absolute bg-black/60 pointer-events-none" style={maskBottom()} />
              <div class="absolute bg-black/60 pointer-events-none" style={maskLeft()} />
              <div class="absolute bg-black/60 pointer-events-none" style={maskRight()} />
              <div class="absolute border-2 border-amber-400 cursor-move" style={selectionStyle()} onPointerDown={handlePointerDown("move")}>
                <span class="absolute inset-0 ring-1 ring-amber-400/30 pointer-events-none" />
                <span class="absolute -top-1.5 -left-1.5 w-3 h-3 bg-amber-400 rounded-sm cursor-nwse-resize" onPointerDown={handlePointerDown("tl")} />
                <span class="absolute -top-1.5 -right-1.5 w-3 h-3 bg-amber-400 rounded-sm cursor-nesw-resize" onPointerDown={handlePointerDown("tr")} />
                <span class="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-amber-400 rounded-sm cursor-nesw-resize" onPointerDown={handlePointerDown("bl")} />
                <span class="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-amber-400 rounded-sm cursor-nwse-resize" onPointerDown={handlePointerDown("br")} />
              </div>
            </div>
          )}
        </Show>
        <Show when={!image() && !loadError()}>
          <div class="w-[320px] h-[240px] flex items-center justify-center text-xs text-zinc-500 border border-zinc-700 rounded-lg">
            Loading…
          </div>
        </Show>
      </div>

      <div class="flex items-center justify-between text-xs text-zinc-500 mb-4">
        <span>
          Source crop: <span class="tabular-nums text-zinc-300">{sourceCropSizePx()}</span> px ·
          output {outputSize()}×{outputSize()}
        </span>
        <button
          type="button"
          onClick={recenter}
          class="text-amber-400 hover:text-amber-300 transition-colors cursor-pointer disabled:opacity-50"
          disabled={!image() || props.busy}
        >
          Reset selection
        </button>
      </div>

      <div class="flex justify-end gap-2">
        <Button type="button" intent="secondary" variant="ghost" onClick={props.onCancel} disabled={props.busy}>
          Cancel
        </Button>
        <Button type="button" intent="primary" variant="clip1" onClick={handleApply} disabled={!image() || props.busy}>
          {props.busy ? "Saving…" : "Apply"}
        </Button>
      </div>
    </Modal>
  );
}
