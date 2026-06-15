import { createSignal, onCleanup, type JSX } from "solid-js";
import Copy from "lucide-solid/icons/copy";
import Check from "lucide-solid/icons/check";

interface CopyButtonProps {
  /** The text written to the clipboard on click. Caller owns the value. */
  text: string;
  /** Label shown in the default state. Default "Copy". */
  label?: string;
  /** Label shown for ~1.5s after a successful copy. Default "Copied". */
  copiedLabel?: string;
  /** Accessible label for the button. Default "Copy". */
  ariaLabel?: string;
  /** Icon size in px. Default 12. */
  size?: number;
  /** Extra classes on the button. */
  class?: string;
}

// Self-contained copy-to-clipboard button. Owns its own "copied" signal:
// on click it writes props.text via navigator.clipboard, flips copied true
// for ~1500ms, swaps the label, and shows the lucide Check icon while copied
// (Copy icon otherwise). The pending timer is cleared on cleanup so a copy
// flash never fires after the button unmounts. No domain coupling — the
// caller passes the text and any label overrides.
export default function CopyButton(props: CopyButtonProps): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const handleClick = () => {
    navigator.clipboard.writeText(props.text).then(() => {
      setCopied(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setCopied(false), 1500);
    });
  };

  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={props.ariaLabel ?? "Copy"}
      class={`ks-interactive px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white text-xs flex items-center gap-1 ${props.class ?? ""}`}
    >
      {copied() ? <Check size={props.size ?? 12} /> : <Copy size={props.size ?? 12} />}
      {copied() ? (props.copiedLabel ?? "Copied") : (props.label ?? "Copy")}
    </button>
  );
}
