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

import { Show, type Component } from "solid-js";
import Paperclip from "lucide-solid/icons/paperclip";
import X from "lucide-solid/icons/x";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import Loader2 from "lucide-solid/icons/loader-2";
import { confirm } from "../../utils/confirm";
import { attachmentUrl, isResolvableAttachment } from "../../utils/attachments";
import { createObjectUrlResource } from "../../utils/object-url-resource";

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
            class="flex w-24 h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 px-2 text-center text-zinc-500"
            title={
              loading()
                ? `${props.attachment.file_name} (loading)`
                : `${props.attachment.file_name} (file is no longer available)`
            }
          >
            <Show
              when={loading()}
              fallback={<TriangleAlert size={18} class="text-amber-500/70" />}
            >
              <Loader2 size={18} class="animate-spin text-zinc-500" />
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
              target="_blank"
              rel="noopener"
              class="flex w-24 h-24 flex-col items-center justify-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2 text-xs text-zinc-300 hover:border-amber-500/30"
            >
              <FallbackIcon />
              <span class="truncate max-w-full text-[10px]">{props.attachment.file_name}</span>
            </a>
          }
        >
          <a
            href={url()}
            target="_blank"
            rel="noopener"
            class="block rounded-lg border border-zinc-700 overflow-hidden hover:border-amber-500/30"
          >
            <img src={url()} alt={props.attachment.file_name} class="w-24 h-24 object-cover" />
          </a>
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
          class="absolute -top-2 -right-2 flex w-7 h-7 items-center justify-center rounded-full bg-red-600/90 border border-red-400/60 text-white cursor-pointer hover:bg-red-500 active:bg-red-700 shadow-lg"
        >
          <X size={12} />
        </button>
      </Show>
    </div>
  );
}
