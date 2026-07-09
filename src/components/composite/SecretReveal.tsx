// Source: kplugin_user-api-keys/ui/remote/index.tsx (reveal-once callout)
// and the identical block in kplugin_api-keys. A presentational, domain-free
// "save this secret now" callout: an amber bordered box with a warning line, a
// monospace code showing the secret value, a copy button, and an optional
// footer caption. The caller decides when to mount it (wrap in
// <Show when={revealed()}>); this component holds no fetch, no plugin state.

import type { Component } from "solid-js";
import { Show, createSignal, splitProps } from "solid-js";
import Copy from "lucide-solid/icons/copy";

export interface SecretRevealProps {
  /** The secret string to display and copy. */
  secret: string;
  /** Warning line shown above the secret. */
  warning?: string;
  /** Optional footer caption, e.g. "Key for: agentic-laptop". */
  caption?: string;
  /** Optional test id applied to the monospace secret code element. */
  testId?: string;
}

const DEFAULT_WARNING = "Save this now - it will not be shown again.";

const SecretReveal: Component<SecretRevealProps> = (props) => {
  const [local] = splitProps(props, ["secret", "warning", "caption", "testId"]);
  const [copied, setCopied] = createSignal(false);

  const copy = () => {
    navigator.clipboard.writeText(local.secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div class="mb-4 p-3 rounded-lg bg-[rgba(245,158,11,0.1)] border border-[rgba(245,158,11,0.2)]">
      <p class="text-xs text-[var(--ks-accent-hover,#fcd34d)] font-medium mb-2">{local.warning ?? DEFAULT_WARNING}</p>
      <div class="flex items-center gap-2">
        <code
          data-testid={local.testId}
          class="flex-1 px-2 py-1.5 rounded bg-[var(--ks-input-bg,#18181b)] border border-[var(--ks-input-border,#3f3f46)] text-[#fde68a] text-xs font-mono break-all"
        >
          {local.secret}
        </code>
        <button
          type="button"
          onClick={copy}
          class="ks-interactive px-2 py-1.5 rounded bg-[#27272a] border border-[var(--ks-input-border,#3f3f46)] text-[#d4d4d8] hover:text-[var(--ks-fg,#ffffff)] text-xs flex items-center gap-1"
          aria-label="Copy secret"
        >
          <Copy size={12} />
          {copied() ? "Copied" : "Copy"}
        </button>
      </div>
      <Show when={local.caption}>
        <p class="text-[10px] text-[var(--ks-fg-subtle,#71717a)] mt-2">{local.caption}</p>
      </Show>
    </div>
  );
};

export default SecretReveal;
