// Renders one already-uploaded attachment as a 24×24 tile: an image preview or
// a paperclip/file fallback linking to the s3_link public URL, an "Unavailable"
// placeholder when the link can't be resolved (see lib/attachments.ts), and an
// optional remove button. confirm comes from the host UI kit. The third of the
// attachment widget set alongside AddAttachmentTile + CameraCapture.

import { Show, type Component } from "solid-js";
import Paperclip from "lucide-solid/icons/paperclip";
import X from "lucide-solid/icons/x";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { confirm } from "@kserp/host-ui";
import { attachmentUrl, isResolvableAttachment } from "../../utils/attachments";

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
}

export default function ExistingAttachmentTile(props: Props) {
  const url = () => attachmentUrl(props.attachment.s3_link);
  const FallbackIcon = () => {
    const Icon = props.fallbackIcon ?? Paperclip;
    return <Icon size={20} />;
  };

  return (
    <div class="relative group shrink-0" data-testid={props.testId}>
      <Show
        when={isResolvableAttachment(props.attachment.s3_link)}
        fallback={
          <div
            class="flex w-24 h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 px-2 text-center text-zinc-500"
            title={`${props.attachment.file_name} (file is no longer available)`}
          >
            <TriangleAlert size={18} class="text-amber-500/70" />
            <span class="truncate max-w-full text-[10px]">{props.attachment.file_name}</span>
            <span class="text-[9px] uppercase tracking-wider">Unavailable</span>
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
