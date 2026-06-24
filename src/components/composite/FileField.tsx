// U6 — FileField (Vision §11): a declarative file/media input for the spec-driven
// form runtime. Its value is an OPAQUE asset HANDLE (`{ id, name, mime, size }`),
// not a path or URL (§11 / Data Arch §4 opaque-id storage). The component is
// storage-agnostic: it knows nothing about S3/MinIO/the kernel. The HOST injects
// two callbacks:
//   - onUpload(file) => Promise<handle>   wires to the kernel asset service
//   - presignUrl(handle) => Promise<url>  resolves a handle to a time-limited URL
// ksui only models the field UX + state machine (pending / uploading / done /
// failed) and the preview. A missing/expired asset degrades gracefully — a
// rejected presign shows a broken-thumbnail fallback + warns, never throws (§11).
//
// Composite because it composes the upload/preview state machine and self-injects
// its CSS (ksui-ff-* unscoped classes + CSS custom props); no Tailwind, no
// host-brand classes (standalone-library rule).

import type { Component, JSX } from "solid-js";
import { Match, Show, Switch, createSignal } from "solid-js";
import UploadCloud from "lucide-solid/icons/cloud-upload";
import FileIcon from "lucide-solid/icons/file";
import ImageOff from "lucide-solid/icons/image-off";
import X from "lucide-solid/icons/x";

/** The opaque asset handle the field stores as its value (§11). */
export interface AssetHandle {
  readonly id: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
}

/** Upload/preview lifecycle (§11: pending while queued, failed on hard error). */
export type FileFieldStatus = "empty" | "uploading" | "done" | "failed";

const STYLE_ID = "ksui-file-field-style";

function ensureStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.ksui-ff{display:flex;flex-direction:column;gap:0.5rem;}
.ksui-ff-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.375rem;padding:1.25rem;border-radius:0.625rem;border:1.5px dashed var(--ksui-ff-border,rgba(255,255,255,0.2));background:var(--ksui-ff-bg,rgba(255,255,255,0.03));color:var(--ksui-ff-fg,inherit);cursor:pointer;text-align:center;font-size:0.82rem;transition:border-color .15s,background .15s;}
.ksui-ff-drop.dragging{border-color:var(--ksui-ff-accent,#c9a961);background:var(--ksui-ff-accent-bg,rgba(201,169,97,0.08));}
.ksui-ff-drop:disabled{opacity:0.5;cursor:not-allowed;}
.ksui-ff-hint{font-size:0.72rem;opacity:0.6;}
.ksui-ff-card{display:flex;align-items:center;gap:0.625rem;padding:0.5rem 0.625rem;border-radius:0.5rem;border:1px solid var(--ksui-ff-border,rgba(255,255,255,0.15));background:var(--ksui-ff-bg,rgba(255,255,255,0.03));}
.ksui-ff-thumb{width:2.5rem;height:2.5rem;border-radius:0.375rem;object-fit:cover;flex:0 0 auto;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;}
.ksui-ff-meta{display:flex;flex-direction:column;min-width:0;flex:1;}
.ksui-ff-name{font-size:0.82rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ksui-ff-sub{font-size:0.72rem;opacity:0.6;}
.ksui-ff-sub.failed{color:var(--ksui-ff-danger,#f87171);}
.ksui-ff-remove{margin-left:auto;flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:1.75rem;height:1.75rem;border-radius:0.375rem;border:1px solid var(--ksui-ff-border,rgba(255,255,255,0.15));background:transparent;color:inherit;cursor:pointer;}
.ksui-ff-retry{font-size:0.72rem;text-decoration:underline;cursor:pointer;color:var(--ksui-ff-accent,#c9a961);background:none;border:none;padding:0;}
`;
  document.head.appendChild(style);
}

export interface FileFieldProps {
  /** Field label. */
  label?: string;
  /** Current value — an asset handle, or null when empty. */
  value?: AssetHandle | null;
  /** Emitted when the handle changes (upload done, or cleared to null). */
  onChange?: (handle: AssetHandle | null) => void;
  /**
   * HOST-injected uploader: takes the picked File, returns the asset handle once
   * the kernel asset service has stored it. ksui stays storage-agnostic (§11).
   */
  onUpload: (file: File) => Promise<AssetHandle>;
  /**
   * HOST-injected resolver: turns a handle into a time-limited URL for preview
   * (§11). ksui never knows about S3/kernel. A rejection degrades to a broken-
   * thumbnail fallback — never throws.
   */
  presignUrl?: (handle: AssetHandle) => Promise<string>;
  /** Accept hint (e.g. ["image/*","application/pdf"]) for the picker + filter. */
  accept?: readonly string[];
  /** Disable interaction. */
  disabled?: boolean;
  /** Optional test id prefix. */
  testId?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FileField: Component<FileFieldProps> = (props) => {
  ensureStyle();
  const [status, setStatus] = createSignal<FileFieldStatus>(props.value ? "done" : "empty");
  // The handle currently shown. Seeded from props.value, and updated locally on a
  // fresh upload so the done card shows even when the parent doesn't echo onChange
  // back into `value` (controlled and uncontrolled both work).
  const [current, setCurrent] = createSignal<AssetHandle | null>(props.value ?? null);
  const [dragging, setDragging] = createSignal(false);
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);
  const [previewFailed, setPreviewFailed] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  let inputEl: HTMLInputElement | undefined;

  const tid = (s: string) => (props.testId ? `${props.testId}-${s}` : undefined);
  const acceptAttr = () => props.accept?.join(",");

  const isImage = (h: AssetHandle | null | undefined) => !!h && h.mime.startsWith("image/");

  // Resolve a preview URL for an image handle via the injected presigner. A
  // rejected presign (missing/expired asset, §11) sets previewFailed instead of
  // throwing — the card then shows the broken-thumbnail fallback + a warning.
  const loadPreview = (handle: AssetHandle) => {
    setPreviewUrl(null);
    setPreviewFailed(false);
    if (!isImage(handle) || !props.presignUrl) return;
    props
      .presignUrl(handle)
      .then((url) => setPreviewUrl(url))
      .catch((e) => {
        setPreviewFailed(true);
        console.warn(`[ksui] FileField: preview unavailable for "${handle.name}"`, e);
      });
  };

  // Drive the upload state machine for a picked/dropped file.
  const upload = (file: File) => {
    setErrorMsg(null);
    setStatus("uploading");
    props
      .onUpload(file)
      .then((handle) => {
        setStatus("done");
        setCurrent(handle);
        props.onChange?.(handle);
        loadPreview(handle);
      })
      .catch((e) => {
        setStatus("failed");
        // §11: a hard failure tells the user it couldn't upload — never throws up.
        setErrorMsg(e instanceof Error ? e.message : "Couldn't upload to the cloud");
        console.warn("[ksui] FileField: upload failed", e);
      });
  };

  // If a value handle is supplied at mount, load its preview eagerly.
  if (props.value) loadPreview(props.value);

  const pick = () => {
    if (props.disabled) return;
    inputEl?.click();
  };

  const onPicked = (e: Event & { currentTarget: HTMLInputElement }) => {
    const file = e.currentTarget.files?.[0];
    if (file) upload(file);
    e.currentTarget.value = ""; // allow re-picking the same file
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (props.disabled) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) upload(file);
  };

  const clear = () => {
    setStatus("empty");
    setCurrent(null);
    setPreviewUrl(null);
    setPreviewFailed(false);
    setErrorMsg(null);
    props.onChange?.(null);
  };

  // Prefer a controlled value when the parent supplies one; else the locally
  // tracked handle from the last upload.
  const handle = () => props.value ?? current();

  return (
    <div class="ksui-ff" data-testid={tid("root")}>
      <Show when={props.label}>
        <span class="ksui-ff-label">{props.label}</span>
      </Show>

      <input
        ref={inputEl}
        type="file"
        accept={acceptAttr()}
        style={{ display: "none" }}
        data-testid={tid("input")}
        onChange={onPicked}
      />

      <Switch>
        {/* empty → the drop zone / click-to-pick affordance */}
        <Match when={status() === "empty"}>
          <button
            type="button"
            class={`ksui-ff-drop${dragging() ? " dragging" : ""}`}
            disabled={props.disabled}
            data-testid={tid("drop")}
            data-dragging={dragging() ? "true" : "false"}
            onClick={pick}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <UploadCloud size={22} />
            <span>Drop a file or click to upload</span>
            <Show when={props.accept?.length}>
              <span class="ksui-ff-hint">{props.accept!.join(", ")}</span>
            </Show>
          </button>
        </Match>

        {/* uploading → pending state (§11 pending while queued) */}
        <Match when={status() === "uploading"}>
          <div class="ksui-ff-card" data-testid={tid("uploading")}>
            <span class="ksui-ff-thumb">
              <UploadCloud size={18} />
            </span>
            <div class="ksui-ff-meta">
              <span class="ksui-ff-name">Uploading…</span>
              <span class="ksui-ff-sub">Sending to the cloud</span>
            </div>
          </div>
        </Match>

        {/* failed → hard-failure notice + retry (§11: tell the user, never throw) */}
        <Match when={status() === "failed"}>
          <div class="ksui-ff-card" data-testid={tid("failed")}>
            <span class="ksui-ff-thumb">
              <ImageOff size={18} />
            </span>
            <div class="ksui-ff-meta">
              <span class="ksui-ff-name">Upload failed</span>
              <span class="ksui-ff-sub failed">{errorMsg() ?? "Couldn't upload to the cloud"}</span>
            </div>
            <button type="button" class="ksui-ff-retry" data-testid={tid("retry")} onClick={pick}>
              Retry
            </button>
          </div>
        </Match>

        {/* done → the asset card with image preview (graceful-degrade fallback) */}
        <Match when={status() === "done" && !!handle()}>
          {renderDoneCard(handle()!, isImage(handle()), previewUrl(), previewFailed(), () => setPreviewFailed(true), props.disabled, clear, tid)}
        </Match>
      </Switch>
    </div>
  );
};

function renderDoneCard(
  h: AssetHandle,
  image: boolean,
  url: string | null,
  failed: boolean,
  onImgError: () => void,
  disabled: boolean | undefined,
  onClear: () => void,
  tid: (s: string) => string | undefined,
): JSX.Element {
  return (
    <div class="ksui-ff-card" data-testid={tid("done")}>
      <span class="ksui-ff-thumb" data-testid={tid("thumb")}>
        <Switch fallback={<FileIcon size={18} />}>
          {/* image + a presigned url that loaded → real thumbnail */}
          <Match when={image && url && !failed}>
            <img
              src={url!}
              alt={h.name}
              class="ksui-ff-thumb"
              data-testid={tid("preview")}
              onError={onImgError}
            />
          </Match>
          {/* image but the presign rejected/expired → broken-thumbnail fallback (§11) */}
          <Match when={image && failed}>
            <ImageOff size={18} data-testid={tid("broken")} />
          </Match>
        </Switch>
      </span>
      <div class="ksui-ff-meta">
        <span class="ksui-ff-name">{h.name}</span>
        <span class="ksui-ff-sub">{formatSize(h.size)}</span>
      </div>
      <Show when={!disabled}>
        <button type="button" class="ksui-ff-remove" aria-label="Remove file" data-testid={tid("remove")} onClick={onClear}>
          <X size={14} />
        </button>
      </Show>
    </div>
  );
}

export default FileField;
