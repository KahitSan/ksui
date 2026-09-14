import { Show, createUniqueId, type JSX } from "solid-js";
import X from "lucide-solid/icons/x";
import { injectCSS } from "../../utils/inject-css";

const STYLE_ID = "ksui-modal-header-style";
const STYLE_CSS = `
.ksui-modal-header{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;margin-bottom:1rem;padding-bottom:.75rem;border-bottom:1px solid var(--ksui-modal-header-border,var(--ks-border,rgba(39,39,42,0.5)));}
.ksui-modal-header__copy{min-width:0;}
.ksui-modal-header__title{margin:0;overflow:hidden;color:var(--ksui-modal-header-fg,var(--ks-fg,#ffffff));font-size:1.125rem;line-height:1.75rem;font-weight:600;text-overflow:ellipsis;white-space:nowrap;}
.ksui-modal-header__subtitle{margin-top:.125rem;color:var(--ksui-modal-header-muted,var(--ks-fg-muted,#a1a1aa));font-size:.75rem;line-height:1rem;}
.ksui-modal-header__close{display:inline-flex;width:2rem;height:2rem;flex:none;align-items:center;justify-content:center;border:0;border-radius:.375rem;background:transparent;color:var(--ksui-modal-header-muted,var(--ks-fg-muted,#a1a1aa));cursor:pointer;transition:background-color .15s ease,color .15s ease;}
.ksui-modal-header__close:hover{background:var(--ksui-modal-header-hover,var(--ks-surface-raised,#1a1a1a));color:var(--ksui-modal-header-fg,var(--ks-fg,#ffffff));}
.ksui-modal-header__close:focus-visible{outline:2px solid var(--ksui-modal-header-focus,var(--ks-focus-ring,#c9a961));outline-offset:2px;}
`;

export interface ModalHeaderProps {
  title: string | (() => JSX.Element);
  subtitle?: string | (() => JSX.Element);
  onClose: () => void;
  closeLabel?: string;
  titleId?: string;
  class?: string;
}

function renderContent(content: string | (() => JSX.Element)): JSX.Element {
  return typeof content === "function" ? content() : content;
}

export default function ModalHeader(props: ModalHeaderProps): JSX.Element {
  injectCSS(STYLE_ID, STYLE_CSS);
  const generatedId = createUniqueId();
  return (
    <header class={`ksui-modal-header ${props.class ?? ""}`}>
      <div class="ksui-modal-header__copy">
        <h2 id={props.titleId ?? generatedId} class="ksui-modal-header__title">{renderContent(props.title)}</h2>
        <Show when={props.subtitle}>
          <div class="ksui-modal-header__subtitle">{renderContent(props.subtitle!)}</div>
        </Show>
      </div>
      <button type="button" aria-label={props.closeLabel ?? "Close"} class="ksui-modal-header__close" onClick={props.onClose}>
        <X size={16} aria-hidden="true" />
      </button>
    </header>
  );
}
