// U8 — CustomRenderer (Vision §8): renders a registered, schema-bound custom
// renderer by id, with a SAFE fallback when the id is unregistered or the props
// don't satisfy the renderer's declared `consumes` contract.
//
// It is a composite because it reads the in-process renderer registry
// (utils/renderers) and wires the `emit` guard. The registry holds only
// build-time, in-process components — no eval, no remote code (see renderers.ts
// for the supply-chain-trust rationale).

import type { Component } from "solid-js";
import { Show, createMemo } from "solid-js";
import { Dynamic } from "solid-js/web";
import AlertTriangle from "lucide-solid/icons/triangle-alert";
import {
  getRenderer,
  validateConsumes,
  type RendererProps,
} from "../../utils/renderers";

const STYLE_ID = "ksui-custom-renderer-style";

function ensureStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Unscoped ksui-* classes + CSS custom properties so a host can retint without
  // forking; no Tailwind, no host-brand classes (standalone-library rule).
  style.textContent = `
.ksui-cr-fallback{display:flex;align-items:center;gap:0.5rem;padding:0.625rem 0.75rem;border-radius:0.5rem;font-size:0.8125rem;background:var(--ksui-cr-fallback-bg,rgba(245,158,11,0.08));border:1px solid var(--ksui-cr-fallback-border,rgba(245,158,11,0.25));color:var(--ksui-cr-fallback-fg,#fbbf24);}
.ksui-cr-fallback svg{flex:0 0 auto;}
`;
  document.head.appendChild(style);
}

export interface CustomRendererProps {
  /** Registered renderer id to look up (§8). */
  id: string;
  /** The data object to render; validated against the renderer's `consumes`. */
  item: Record<string, unknown>;
  /**
   * Fire one of the renderer's declared `emits`. An undeclared emit is dropped
   * with a console.warn — a renderer cannot forge an interaction it never
   * declared (§8: it can misbehave on screen but never escalate authority).
   */
  onEmit?: (event: string, payload?: unknown) => void;
  /**
   * Optional custom fallback when the id is unknown or props don't match. When
   * omitted a built-in warning chip renders (never throws — §8 graceful degrade).
   */
  fallback?: Component<{ id: string; reason: string }>;
}

const DefaultFallback: Component<{ id: string; reason: string }> = (props) => {
  ensureStyle();
  return (
    <div class="ksui-cr-fallback" role="status" data-testid="ksui-cr-fallback">
      <AlertTriangle size={14} />
      <span>Renderer "{props.id}" unavailable</span>
    </div>
  );
};

export const CustomRenderer: Component<CustomRendererProps> = (props) => {
  // Resolve id → definition + validate props on every change. A miss (unknown id
  // OR schema mismatch) yields a reason string and the fallback renders.
  const resolved = createMemo<
    | { kind: "ok"; render: Component<RendererProps>; emits: readonly string[] }
    | { kind: "fallback"; reason: string }
  >(() => {
    const def = getRenderer(props.id);
    if (!def) return { kind: "fallback", reason: `unregistered id "${props.id}"` };
    const v = validateConsumes(def.consumes, props.item);
    if (!v.ok) return { kind: "fallback", reason: v.errors.join("; ") };
    return { kind: "ok", render: def.render, emits: def.emits };
  });

  // Guard emits: only declared interaction points pass through (§8). An
  // undeclared name is dropped + warned, never forwarded to the host.
  const emit = (event: string, payload?: unknown) => {
    const r = resolved();
    if (r.kind !== "ok") return;
    if (!r.emits.includes(event)) {
      console.warn(
        `[ksui] CustomRenderer "${props.id}": ignored undeclared emit "${event}" (declared: ${r.emits.join(", ") || "none"})`,
      );
      return;
    }
    props.onEmit?.(event, payload);
  };

  return (
    <Show
      when={resolved().kind === "ok"}
      fallback={(() => {
        const r = resolved();
        const reason = r.kind === "fallback" ? r.reason : "";
        // WHY warn here: a fallback means a spec referenced a renderer the bundle
        // doesn't satisfy — a build/config drift the developer must see (§8).
        console.warn(`[ksui] CustomRenderer falling back for "${props.id}": ${reason}`);
        const Fallback = props.fallback ?? DefaultFallback;
        return <Fallback id={props.id} reason={reason} />;
      })()}
    >
      <Dynamic
        component={(resolved() as { render: Component<RendererProps> }).render}
        item={props.item}
        emit={emit}
      />
    </Show>
  );
};

export default CustomRenderer;
