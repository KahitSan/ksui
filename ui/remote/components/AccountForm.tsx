import { createSignal, Show, For, onCleanup, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

import {
  ACCOUNT_ICON_LABELS,
  ACCOUNT_ICON_SLUGS,
  getAccountIcon,
  getAccountTone,
  ImageCropper,
  FileField,
  Button,
  type AccountIconSlug,
  type AssetHandle,
} from "@kahitsan/ksui";

import Trash from "lucide-solid/icons/trash-2";

export interface AccountFormProps {
  error: string;
  saving: boolean;
  name: string;
  setName: (v: string) => void;
  type: string;
  setType: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  icon: AccountIconSlug | "";
  setIcon: (v: AccountIconSlug | "") => void;
  color: string;
  setColor: (v: string) => void;
  defaultPayment: boolean;
  setDefaultPayment: (v: boolean) => void;
  sortOrder: number;
  setSortOrder: (v: number) => void;
  accountId?: number;
  logoBlob: Blob | null;
  setLogoBlob: (b: Blob | null) => void;
  logoExistingS3: string | null;
  logoClear: boolean;
  setLogoClear: (v: boolean) => void;
  // Workspace header so the form's own A1 presign read carries the same
  // X-Workspace-Id (+ cookies) every sibling fetch sends, or presign 404s.
  wsHeaders: () => HeadersInit;
  onSubmit: () => void;
  submitLabel: string;
  onCancel?: () => void;
}

export function AccountForm(props: AccountFormProps) {
  const previewAccount = () => ({
    icon: props.icon || null,
    color: props.color || null,
    type: props.type,
  });

  const [pickedFile, setPickedFile] = createSignal<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = createSignal<string>("");

  // U6 — FileField drives the picker + upload/preview state machine. Its own pick
  // hands us the RAW file via onUpload; we route it through ImageCropper (1:1 webp)
  // and only then complete the upload. The resolver returned to FileField settles
  // when the user applies the crop (or rejects on cancel).
  let cropResolve: ((h: AssetHandle) => void) | null = null;
  let cropReject: ((reason?: unknown) => void) | null = null;

  function refreshPendingPreview(blob: Blob | null) {
    const previous = pendingPreviewUrl();
    if (blob) {
      const url = URL.createObjectURL(blob);
      setPendingPreviewUrl(url);
    } else {
      setPendingPreviewUrl("");
    }
    if (previous) URL.revokeObjectURL(previous);
  }

  onCleanup(() => {
    const current = pendingPreviewUrl();
    if (current) URL.revokeObjectURL(current);
    // A pending crop with the cropper still open must not leave FileField stuck
    // in its "uploading" state after the form unmounts.
    cropReject?.(new Error("cancelled"));
  });

  // FileField's onUpload: open the cropper on the raw pick, resolve once the user
  // applies. The cropped blob is DEFERRED to the parent's save handler (the
  // existing model — so Cancel discards an unsaved logo and edit never double-
  // POSTs); the resolved handle is built from the pending blob, not a live upload.
  function onFileFieldUpload(file: File): Promise<AssetHandle> {
    return new Promise<AssetHandle>((resolve, reject) => {
      cropReject?.(new Error("superseded"));
      cropResolve = resolve;
      cropReject = reject;
      setPickedFile(file);
    });
  }

  function onCropperApply(blob: Blob) {
    props.setLogoBlob(blob);
    refreshPendingPreview(blob);
    props.setLogoClear(false);
    setPickedFile(null);
    const resolve = cropResolve;
    cropResolve = null;
    cropReject = null;
    // The handle carries the blob size so the done-card reads sensibly; the real
    // upload is the parent's job on save.
    resolve?.({
      id: "pending",
      name: "logo.webp",
      mime: "image/webp",
      size: blob.size,
    });
  }

  function onCropperCancel() {
    setPickedFile(null);
    const reject = cropReject;
    cropResolve = null;
    cropReject = null;
    reject?.(new Error("cancelled"));
  }

  // FileField's clear (X on the done card) maps onto the existing remove semantics.
  function onFileFieldChange(h: AssetHandle | null) {
    if (h) return;
    removeLogo();
  }

  function removeLogo() {
    if (props.logoBlob) {
      props.setLogoBlob(null);
      refreshPendingPreview(null);
      return;
    }
    if (props.logoExistingS3) {
      props.setLogoClear(true);
    }
  }

  function undoRemove() {
    props.setLogoClear(false);
  }

  // The handle FileField renders. A freshly cropped blob (pending or just uploaded)
  // or an existing saved logo both surface as a done-card; null shows the dropzone.
  const fileFieldValue = (): AssetHandle | null => {
    if (props.logoBlob) {
      return {
        id: "pending",
        name: "logo.webp",
        mime: "image/webp",
        size: props.logoBlob.size,
      };
    }
    if (props.logoExistingS3 && !props.logoClear) {
      return {
        id: props.logoExistingS3,
        name: "logo.webp",
        mime: "image/webp",
        size: 0,
      };
    }
    return null;
  };

  // Preview resolver FileField AWAITS per handle (once at mount, again on a fresh
  // upload). A pending cropped blob previews from its own object URL; a saved logo
  // is streamed through the authed /logo/raw route and exposed as a same-origin
  // blob: — awaited HERE so FileField never reads a still-pending value (no
  // broken-thumb flash). A failed fetch rejects → FileField's graceful fallback.
  // The saved preview's object URL is revoked on the next resolve and on unmount.
  let savedPreviewUrl: string | null = null;
  const revokeSavedPreview = () => {
    if (savedPreviewUrl) {
      URL.revokeObjectURL(savedPreviewUrl);
      savedPreviewUrl = null;
    }
  };
  onCleanup(revokeSavedPreview);
  async function resolvePreview(handle: AssetHandle): Promise<string> {
    if (handle.id === "pending") {
      const u = pendingPreviewUrl();
      if (u) return u;
      throw new Error("no preview");
    }
    if (!props.accountId) throw new Error("preview unavailable");
    const res = await fetch(
      `/api/financial-accounts/${props.accountId}/logo/raw`,
      {
        credentials: "include",
        headers: props.wsHeaders(),
      }
    );
    if (!res.ok) throw new Error("preview unavailable");
    revokeSavedPreview();
    savedPreviewUrl = URL.createObjectURL(await res.blob());
    return savedPreviewUrl;
  }

  // FileField seeds its done/empty state from `value` only at mount, so a value
  // change that didn't originate from its own pick (paste, post-save, remove,
  // undo) is reflected by remounting it under this identity key.
  const fileFieldKey = () => {
    if (props.logoBlob) return `pending:${pendingPreviewUrl()}`;
    const v = fileFieldValue();
    return v ? `saved:${v.id}` : "empty";
  };

  // Paste an image anywhere on the form → route the raw file through the same
  // crop-then-upload flow FileField's pick uses (keeps the "you can paste" UX).
  function onFormPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void onFileFieldUpload(file);
          return;
        }
      }
    }
  }

  const hasLogo = () =>
    !!props.logoBlob || (!!props.logoExistingS3 && !props.logoClear);

  const inputClass =
    "w-full rounded-lg border border-ks-border-strong bg-ks-surface-raised/50 px-3 py-2 text-sm text-ks-fg focus:border-ks-accent/50 focus:outline-none";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit();
      }}
      onPaste={onFormPaste}
      class="space-y-4"
    >
      <Show when={props.error}>
        <div class="rounded-lg border border-ks-danger/30 bg-ks-danger/10 px-3 py-2 text-sm text-ks-danger">
          {props.error}
        </div>
      </Show>

      <FormField label="Name *">
        <input
          type="text"
          data-testid="accounts-form-name"
          value={props.name}
          onInput={(e) => props.setName(e.target.value)}
          class={inputClass}
          placeholder='e.g. "BDO Savings", "GCash - Luis", "Petty Cash"'
          required
        />
      </FormField>

      <FormField label="Type *">
        <select
          data-testid="accounts-form-type"
          value={props.type}
          onChange={(e) => props.setType(e.target.value)}
          class={`${inputClass} cursor-pointer`}
        >
          <option value="cash">Cash</option>
          <option value="bank">Bank</option>
          <option value="e_wallet">E-Wallet</option>
          <option value="external">External</option>
          <option value="capital">Capital</option>
        </select>
      </FormField>

      <FormField label="Logo">
        <div class="flex flex-col gap-2">
          {/* U6 — ksui FileField owns the picker + upload/preview state machine.
              Its raw pick is routed through ImageCropper (1:1 webp) before upload,
              and its preview reads the A1 presigned URL via resolvePreview. Keyed
              so an external value change (paste/save/remove) remounts the field. */}
          <Show when={fileFieldKey()} keyed>
            <FileField
              value={fileFieldValue()}
              onUpload={onFileFieldUpload}
              onChange={onFileFieldChange}
              presignUrl={resolvePreview}
              accept={["image/png", "image/jpeg", "image/webp"]}
              disabled={props.saving}
              testId="accounts-form-logo"
            />
          </Show>
          <div class="flex flex-wrap items-center gap-3">
            <Show
              when={props.logoExistingS3 && !props.logoClear && !props.logoBlob}
            >
              <button
                type="button"
                onClick={removeLogo}
                class="inline-flex items-center gap-1 text-xs text-ks-fg-muted hover:text-ks-danger transition-colors cursor-pointer"
                disabled={props.saving}
              >
                <Trash size={14} />
                Remove
              </button>
            </Show>
            <Show
              when={props.logoClear && props.logoExistingS3 && !props.logoBlob}
            >
              <button
                type="button"
                onClick={undoRemove}
                class="text-xs text-ks-accent hover:text-ks-accent-hover transition-colors cursor-pointer"
                disabled={props.saving}
              >
                Undo remove
              </button>
            </Show>
          </div>
          <span class="text-[11px] text-ks-fg-muted">
            Cropped to a 1:1 square. Pick a logo or an icon, not both. You can
            also paste an image here.
          </span>
          <Show when={props.logoClear && !props.logoBlob}>
            <span class="text-[11px] text-ks-danger">
              Logo will be removed when you save.
            </span>
          </Show>
        </div>
      </FormField>

      <Show when={pickedFile()}>
        {(file) => (
          <ImageCropper
            file={file()}
            onApply={onCropperApply}
            onCancel={onCropperCancel}
            busy={props.saving}
          />
        )}
      </Show>

      <Show
        when={!hasLogo()}
        fallback={
          <FormField label="Icon">
            <p class="text-[11px] text-ks-fg-muted italic">
              Hidden because a logo is set. Remove the logo above to pick an
              icon instead.
            </p>
          </FormField>
        }
      >
        <FormField label="Icon">
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => props.setIcon("")}
              title="Use default for type"
              aria-pressed={props.icon === ""}
              class="px-2 py-1 rounded border text-[11px]"
              classList={{
                "border-ks-accent/60 bg-ks-accent/10 text-ks-accent-hover":
                  props.icon === "",
                "border-ks-border-strong text-ks-fg-muted hover:border-ks-border-strong":
                  props.icon !== "",
              }}
            >
              Default
            </button>
            <For each={ACCOUNT_ICON_SLUGS}>
              {(slug) => {
                const Ico = getAccountIcon({ icon: slug, type: props.type });
                return (
                  <button
                    type="button"
                    onClick={() => props.setIcon(slug)}
                    title={ACCOUNT_ICON_LABELS[slug]}
                    aria-label={ACCOUNT_ICON_LABELS[slug]}
                    aria-pressed={props.icon === slug}
                    class="w-9 h-9 rounded border flex items-center justify-center"
                    classList={{
                      "border-ks-accent/60 bg-ks-accent/10 text-ks-accent-hover":
                        props.icon === slug,
                      "border-ks-border-strong text-ks-fg-muted hover:border-ks-border-strong hover:text-ks-fg":
                        props.icon !== slug,
                    }}
                  >
                    <Ico size={16} />
                  </button>
                );
              }}
            </For>
          </div>
        </FormField>
      </Show>

      <FormField label="Accent color">
        <div class="flex items-center gap-3">
          <input
            type="color"
            data-testid="accounts-form-color"
            value={props.color || "#71717a"}
            onInput={(e) => props.setColor(e.currentTarget.value)}
            class="w-12 h-9 rounded border border-ks-border-strong bg-ks-surface-raised/50 cursor-pointer"
            aria-label="Accent color"
          />
          <Show
            when={props.color}
            fallback={
              <span class="text-xs text-ks-fg-muted italic">
                Using default tone for type
              </span>
            }
          >
            <code class="text-xs text-ks-fg-muted font-mono">
              {props.color}
            </code>
            <button
              type="button"
              onClick={() => props.setColor("")}
              class="text-xs text-ks-fg-muted hover:text-ks-danger cursor-pointer"
            >
              Reset
            </button>
          </Show>
          <div class="ml-auto flex items-center gap-2">
            <span class="text-[10px] text-ks-fg-muted uppercase tracking-widest">
              Preview
            </span>
            {(() => {
              const Ico = getAccountIcon(previewAccount());
              const tone = getAccountTone(previewAccount());
              return (
                <div
                  class={`w-8 h-8 rounded flex items-center justify-center border ${
                    tone.class ?? ""
                  }`}
                  style={tone.style}
                >
                  <Dynamic component={Ico} size={14} />
                </div>
              );
            })()}
          </div>
        </div>
      </FormField>

      <FormField label="Description">
        <textarea
          data-testid="accounts-form-description"
          value={props.description}
          onInput={(e) => props.setDescription(e.target.value)}
          class={`${inputClass} resize-none`}
          rows={3}
          placeholder="Optional description..."
        />
      </FormField>

      <div class="grid gap-4 sm:grid-cols-2">
        <FormField label="Payment default">
          <label class="flex min-h-10 items-center gap-2 rounded-lg border border-ks-border-strong bg-ks-surface-raised/50 px-3 py-2 text-sm text-ks-fg">
            <input
              type="checkbox"
              data-testid="accounts-form-default-payment"
              checked={props.defaultPayment}
              onChange={(e) => props.setDefaultPayment(e.currentTarget.checked)}
              class="h-4 w-4"
            />
            <span>Default for payments</span>
          </label>
        </FormField>

        <FormField label="Sort order">
          <input
            type="number"
            min="0"
            step="1"
            data-testid="accounts-form-sort-order"
            value={String(props.sortOrder)}
            onInput={(e) => {
              const next = parseInt(e.currentTarget.value, 10);
              props.setSortOrder(Number.isFinite(next) && next >= 0 ? next : 0);
            }}
            class={inputClass}
          />
        </FormField>
      </div>

      <div class="flex justify-end gap-3 pt-2">
        <Show when={props.onCancel}>
          <Button
            intent="secondary"
            variant="ghost"
            onClick={props.onCancel}
            disabled={props.saving}
          >
            Cancel
          </Button>
        </Show>
        <Button
          intent="primary"
          variant="clip1"
          data-testid="accounts-form-submit"
          disabled={props.saving}
          onClick={props.onSubmit}
        >
          {props.saving ? "Saving..." : props.submitLabel}
        </Button>
      </div>
    </form>
  );
}

function FormField(props: { label: string; children: JSX.Element }) {
  return (
    <div>
      <label class="block text-xs text-ks-fg-muted mb-1">{props.label}</label>
      {props.children}
    </div>
  );
}
