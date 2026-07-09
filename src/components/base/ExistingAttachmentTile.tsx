// Renders one already-uploaded attachment as a 24×24 tile: an image preview or a
// paperclip/file fallback, an "Unavailable" placeholder when the source can't be
// resolved, and an optional remove button. confirm is ksui's own self-contained
// dialog. The third of the attachment widget set alongside AddAttachmentTile +
// CameraCapture.
//
// Two source modes:
//  • default — resolve the PUBLIC s3_link via attachmentUrl() (legacy public bucket).
//  • `rawHref` set — stream the PRIVATE object's bytes from that authed same-origin
//    route and render the resulting blob: (the proxy/blob pattern). s3_link is then
//    ignored for rendering; a spinner shows while the bytes stream.

import { Show, createSignal, type Component } from "solid-js";
import Paperclip from "lucide-solid/icons/paperclip";
import X from "lucide-solid/icons/x";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import Loader2 from "lucide-solid/icons/loader-2";
import { confirm } from "../../utils/confirm";
import { attachmentUrl, isResolvableAttachment } from "../../utils/attachments";
import { createObjectUrlResource } from "../../utils/object-url-resource";
import ImageViewer from "./ImageViewer";

export interface ExistingAttachment {
  id: number;
  file_name: string;
  mime_type: string;
  s3_link: string | null;
}

interface Props {
  attachment: ExistingAttachment;
  testId: string;
  onDelete?: (attachmentId: number) => Promise<void> | void;
  fallbackIcon?: Component<{ size?: number }>;
  // When set, stream the private object's bytes from this authed same-origin route
  // and render a blob: — the proxy/blob mode. When absent, fall back to the public
  // s3_link. The fetch carries credentials; pass extra headers via `rawInit`.
  rawHref?: string;
  rawInit?: RequestInit;
}

export default function ExistingAttachmentTile(props: Props) {
  // Always call the hook (Solid rule); a null href no-ops when not in blob mode.
  const blob = createObjectUrlResource(
    () => props.rawHref ?? null,
    { init: props.rawInit },
  );
  const isBlobMode = () => props.rawHref != null;
  const url = (): string | undefined =>
    isBlobMode() ? (blob() ?? undefined) : attachmentUrl(props.attachment.s3_link);
  const resolvable = () =>
    isBlobMode() ? blob() != null : isResolvableAttachment(props.attachment.s3_link);
  const loading = () => (isBlobMode() ? blob.loading : false);
  const [viewerOpen, setViewerOpen] = createSignal(false);

  const FallbackIcon = () => {
    const Icon = props.fallbackIcon ?? Paperclip;
    return <Icon size={20} />;
  };

  return (
    <div class="relative group shrink-0" data-testid={props.testId}>
      <Show
        when={resolvable()}
        fallback={
          <div
            class="flex w-24 h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--ks-border-strong,#3f3f46)] bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_40%,transparent)] px-2 text-center text-[var(--ks-fg-subtle,#71717a)]"
            title={
              loading()
                ? `${props.attachment.file_name} (loading)`
                : `${props.attachment.file_name} (file is no longer available)`
            }
          >
            <Show
              when={loading()}
              fallback={<TriangleAlert size={18} class="text-[color-mix(in_srgb,var(--ks-warning,#f59e0b)_70%,transparent)]" />}
            >
              <Loader2 size={18} class="animate-spin text-[var(--ks-fg-subtle,#71717a)]" />
            </Show>
            <span class="truncate max-w-full text-[10px]">{props.attachment.file_name}</span>
            <span class="text-[9px] uppercase tracking-wider">
              {loading() ? "Loading" : "Unavailable"}
            </span>
          </div>
        }
      >
        <Show
          when={props.attachment.mime_type.startsWith("image/")}
          fallback={
            <a
              href={url()}
              download={props.attachment.file_name}
              class="flex w-24 h-24 flex-col items-center justify-center gap-1 rounded-lg border border-[var(--ks-border-strong,#3f3f46)] bg-[color-mix(in_srgb,var(--ks-surface-raised,#1a1a1a)_50%,transparent)] px-2 text-xs text-[var(--ks-fg-muted,#a1a1aa)] hover:border-[color-mix(in_srgb,var(--ks-accent,#fbbf24)_30%,transparent)]"
            >
              <FallbackIcon />
              <span class="truncate max-w-full text-[10px]">{props.attachment.file_name}</span>
            </a>
          }
        >
          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            class="block rounded-lg border border-[var(--ks-border-strong,#3f3f46)] overflow-hidden hover:border-[color-mix(in_srgb,var(--ks-accent,#fbbf24)_30%,transparent)] cursor-pointer"
          >
            <img src={url()} alt={props.attachment.file_name} class="w-24 h-24 object-cover" />
          </button>
        </Show>
      </Show>
      <Show when={props.onDelete}>
        <button
          type="button"
          aria-label={`Remove ${props.attachment.file_name}`}
          onClick={async () => {
            const ok = await confirm({
              title: "Remove attachment?",
              message: `Remove attachment "${props.attachment.file_name}"?`,
              confirmLabel: "Remove",
              danger: true,
            });
            if (ok) await props.onDelete!(props.attachment.id);
          }}
          class="absolute -top-2 -right-2 flex w-7 h-7 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--ks-danger,#ef4444)_90%,transparent)] border border-[color-mix(in_srgb,var(--ks-danger,#ef4444)_60%,transparent)] text-[var(--ks-fg,#ffffff)] cursor-pointer hover:bg-[var(--ks-danger,#ef4444)] active:bg-[var(--ks-danger,#ef4444)] shadow-lg"
        >
          <X size={12} />
        </button>
      </Show>
      <Show when={viewerOpen() && url()}>
        <ImageViewer
          src={url()!}
          alt={props.attachment.file_name}
          onClose={() => setViewerOpen(false)}
        />
      </Show>
    </div>
  );
}
