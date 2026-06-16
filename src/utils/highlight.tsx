// Search-match highlighting + tiny string-match helpers. Ported into ksui from
// the former host kit so the library is self-contained: ComboBox and
// MarkdownNotes used to import `highlightMatch` from "@kserp/host-ui"; they now
// import it from here. Pure functions plus a `<mark>` wrapper.
//
// The default highlight tint ships as injected CSS (a `.ksui-mark` class) so the
// library carries no Tailwind dependency — like Button/ProgressBar, the keyframe
// /helper class is added once per page via a runtime <style> tag. Callers can
// still pass their own `markClass` to override.

import { type JSX } from "solid-js";

const MARK_STYLE_ID = "ksui-mark-style";

function ensureMarkStyle(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(MARK_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = MARK_STYLE_ID;
  style.textContent = `.ksui-mark{background-color:rgba(245,158,11,0.3);color:inherit;border-radius:2px;}`;
  document.head.appendChild(style);
}

/** Case-insensitive substring test. Empty query matches everything. */
export function matchesQuery(text: string | null | undefined, query: string): boolean {
  if (!query) return true;
  if (!text) return false;
  return text.toLowerCase().includes(query.toLowerCase());
}

/** True when the query matches any of the given fields. */
export function matchesAny(query: string, ...fields: (string | null | undefined)[]): boolean {
  if (!query) return true;
  return fields.some((f) => matchesQuery(f, query));
}

/**
 * Wrap every case-insensitive occurrence of `query` inside `text` in a `<mark>`.
 * Pass `markClass` to override the default `.ksui-mark` tint.
 */
export function highlightMatch(text: string, query: string, markClass?: string): JSX.Element {
  if (!query || !text) return <>{text}</>;
  if (!markClass) ensureMarkStyle();
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const out: JSX.Element[] = [];
  let i = 0;
  let idx = lower.indexOf(q, i);
  let key = 0;
  while (idx !== -1) {
    if (idx > i) out.push(<>{text.slice(i, idx)}</>);
    out.push(
      <mark class={markClass ?? "ksui-mark"} data-key={key++}>
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
    idx = lower.indexOf(q, i);
  }
  if (i < text.length) out.push(<>{text.slice(i)}</>);
  return <>{out}</>;
}

/** Component form of {@link highlightMatch}. */
export function HighlightedText(props: { text: string; query: string; markClass?: string }): JSX.Element {
  return <>{highlightMatch(props.text, props.query, props.markClass)}</>;
}
