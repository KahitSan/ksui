// Source: KahitSan/kserp src/components/MentionTextarea.tsx (vendored into the plugin remote).
//
// contenteditable rich-text input with an @-trigger client autocomplete that
// renders selected mentions as chips. Canonical value is the @[Name](client:ID)
// token string. Cross-plugin: searches the SIBLING clients plugin at
// /api/clients; when it 404s the popup just shows no results and the field
// still works as a plain notes editor.

import { Portal } from "solid-js/web";
import { createEffect, createSignal, createUniqueId, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import UserRound from "lucide-solid/icons/user-round";
import Loader2 from "lucide-solid/icons/loader-2";

const POPUP_MAX_HEIGHT = 240;
const POPUP_MIN_WIDTH = 280;
const SEARCH_DEBOUNCE_MS = 150;
const FETCH_LIMIT = 8;

interface ClientHit {
  id: number;
  name_raw: string;
  email?: string | null;
  phone?: string | null;
}

export interface MentionTextareaProps {
  value: string;
  setValue: (next: string) => void;
  placeholder?: string;
  rows?: number;
  class?: string;
  ariaLabel?: string;
  disabled?: boolean;
  onBlur?: () => void;
}

const CHIP_BASE_CLASSES =
  "inline-flex items-baseline align-baseline rounded bg-amber-500/15 text-amber-300 px-1.5 py-px text-[0.9em] mx-px";
const CHIP_UNRESOLVED_CLASSES =
  "inline-flex items-baseline align-baseline rounded bg-zinc-700/40 text-zinc-400 px-1.5 py-px text-[0.9em] mx-px";

function buildMentionChip(name: string, idStr: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.setAttribute("data-mention-id", idStr);
  span.setAttribute("data-mention-name", name);
  span.setAttribute("contenteditable", "false");
  span.className = idStr ? CHIP_BASE_CLASSES : CHIP_UNRESOLVED_CLASSES;
  span.textContent = `@${name}`;
  return span;
}

function hydrateInto(root: HTMLElement, value: string): void {
  while (root.firstChild) root.removeChild(root.firstChild);
  const tokenRe = /@\[([^\]\n]+)\](?:\(client:(\d+)\))?/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(value)) !== null) {
    appendTextWithBreaks(root, value.slice(last, m.index));
    root.appendChild(buildMentionChip(m[1], m[2] ?? ""));
    last = m.index + m[0].length;
  }
  appendTextWithBreaks(root, value.slice(last));
}

function appendTextWithBreaks(root: HTMLElement, text: string): void {
  if (!text) return;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) root.appendChild(document.createElement("br"));
    if (lines[i]) root.appendChild(document.createTextNode(lines[i]));
  }
}

function serialize(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === "BR") {
      out += "\n";
      return;
    }
    const mid = el.getAttribute("data-mention-id");
    const mname = el.getAttribute("data-mention-name");
    if (mid != null && mname != null) {
      out += mid === "" ? `@[${mname}]` : `@[${mname}](client:${mid})`;
      return;
    }
    if (el.tagName === "DIV" && out && !out.endsWith("\n")) out += "\n";
    for (const c of Array.from(el.childNodes)) walk(c);
  };
  for (const c of Array.from(root.childNodes)) walk(c);
  return out;
}

function findTrigger(
  root: HTMLElement,
): { anchor: { node: Text; offset: number }; query: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!r.collapsed) return null;
  if (!root.contains(r.startContainer)) return null;
  if (r.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const node = r.startContainer as Text;
  const offset = r.startOffset;
  const text = node.data;
  for (let i = offset - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "@") {
      const before = i === 0 ? "" : text[i - 1];
      if (before !== "" && !/\s/.test(before)) return null;
      return { anchor: { node, offset: i }, query: text.slice(i + 1, offset) };
    }
    if (/[\s\])[]/.test(ch)) return null;
  }
  return null;
}

export default function MentionTextarea(props: MentionTextareaProps): JSX.Element {
  const listboxId = createUniqueId();
  const optionId = (clientId: number) => `${listboxId}-option-${clientId}`;
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  const [results, setResults] = createSignal<ClientHit[]>([]);
  const [activeIdx, setActiveIdx] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [popupStyle, setPopupStyle] = createSignal<JSX.CSSProperties>({});
  const [isEmpty, setIsEmpty] = createSignal(true);

  let editorRef: HTMLDivElement | undefined;
  let popupRef: HTMLDivElement | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let activeFetchToken = 0;
  let isHydrating = false;
  let isComposing = false;

  const close = () => {
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
    setResults([]);
    setActiveIdx(0);
  };

  const updatePosition = () => {
    if (!editorRef) return;
    const sel = window.getSelection();
    let anchorRect: DOMRect;
    if (sel && sel.rangeCount > 0 && editorRef.contains(sel.getRangeAt(0).startContainer)) {
      const r = sel.getRangeAt(0).cloneRange();
      r.collapse(true);
      const rects = r.getClientRects();
      anchorRect = rects.length > 0 ? rects[0] : (editorRef.getBoundingClientRect() as DOMRect);
    } else {
      anchorRect = editorRef.getBoundingClientRect();
    }
    const editorRect = editorRef.getBoundingClientRect();
    const vpHeight = window.innerHeight;
    const vpWidth = window.innerWidth;
    const width = Math.max(POPUP_MIN_WIDTH, Math.min(editorRect.width, 360));
    const spaceBelow = vpHeight - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    const flipUp = spaceBelow < POPUP_MAX_HEIGHT && spaceAbove > spaceBelow;
    const top = flipUp ? Math.max(8, anchorRect.top - POPUP_MAX_HEIGHT - 4) : anchorRect.bottom + 4;
    const left = Math.min(Math.max(8, anchorRect.left), vpWidth - width - 8);
    setPopupStyle({
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      "max-height": `${POPUP_MAX_HEIGHT}px`,
    });
  };

  createEffect(() => {
    const q = query();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => setDebouncedQuery(q), SEARCH_DEBOUNCE_MS);
    onCleanup(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
    });
  });

  createEffect(() => {
    if (!open()) return;
    const q = debouncedQuery().trim();
    const token = ++activeFetchToken;
    setLoading(true);
    const params = new URLSearchParams({ status: "active", limit: String(FETCH_LIMIT) });
    if (q) params.set("search", q);
    fetch(`/api/clients?${params.toString()}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => {
        if (token !== activeFetchToken) return;
        const hits = (json.data || []) as ClientHit[];
        setResults(hits);
        setActiveIdx((i) => Math.min(i, Math.max(0, hits.length - 1)));
      })
      .catch(() => {
        if (token !== activeFetchToken) return;
        setResults([]);
      })
      .finally(() => {
        if (token !== activeFetchToken) return;
        setLoading(false);
      });
  });

  createEffect(() => {
    if (!open()) return;
    updatePosition();
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (editorRef?.contains(t)) return;
      if (popupRef?.contains(t)) return;
      close();
    };
    const onReflow = () => updatePosition();
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    });
  });

  createEffect(() => {
    const v = props.value;
    if (!editorRef) return;
    if (isHydrating) return;
    if (serialize(editorRef) === v) {
      setIsEmpty(v.length === 0);
      return;
    }
    isHydrating = true;
    hydrateInto(editorRef, v);
    isHydrating = false;
    setIsEmpty(v.length === 0);
  });

  onMount(() => {
    if (!editorRef) return;
    hydrateInto(editorRef, props.value);
    setIsEmpty(props.value.length === 0);
  });

  const emitFromDom = () => {
    if (!editorRef || isHydrating) return;
    const next = serialize(editorRef);
    setIsEmpty(next.length === 0);
    props.setValue(next);
  };

  const refreshTrigger = () => {
    if (!editorRef) return;
    if (isComposing) return;
    const t = findTrigger(editorRef);
    if (!t) {
      if (open()) close();
      return;
    }
    setQuery(t.query);
    if (!open()) {
      setOpen(true);
      setActiveIdx(0);
    }
  };

  const onInput: JSX.EventHandler<HTMLDivElement, InputEvent> = () => {
    if (isHydrating) return;
    emitFromDom();
    refreshTrigger();
  };

  const onPaste: JSX.EventHandler<HTMLDivElement, ClipboardEvent> = (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    document.execCommand("insertText", false, text);
  };

  const insertSelected = (hit: ClientHit) => {
    if (!editorRef) {
      close();
      return;
    }
    const t = findTrigger(editorRef);
    if (!t) {
      close();
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      close();
      return;
    }
    const caretRange = sel.getRangeAt(0);
    const replaceRange = document.createRange();
    replaceRange.setStart(t.anchor.node, t.anchor.offset);
    replaceRange.setEnd(caretRange.endContainer, caretRange.endOffset);
    replaceRange.deleteContents();
    const chip = buildMentionChip(hit.name_raw, String(hit.id));
    const trailing = document.createTextNode(" ");
    replaceRange.insertNode(trailing);
    replaceRange.insertNode(chip);
    const after = document.createRange();
    after.setStartAfter(trailing);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
    close();
    emitFromDom();
  };

  const onKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (e) => {
    if (!open()) return;
    const items = results();
    if (e.key === "ArrowDown") {
      if (items.length === 0) return;
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % items.length);
      return;
    }
    if (e.key === "ArrowUp") {
      if (items.length === 0) return;
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + items.length) % items.length);
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      if (items.length === 0) {
        e.preventDefault();
        close();
        return;
      }
      const hit = items[activeIdx()];
      if (hit) {
        e.preventDefault();
        insertSelected(hit);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
  };

  const onKeyUp: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (e) => {
    if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
      refreshTrigger();
    }
  };

  const onMouseUp: JSX.EventHandler<HTMLDivElement, MouseEvent> = () => {
    refreshTrigger();
  };

  const onCompositionStart = () => {
    isComposing = true;
  };
  const onCompositionEnd = () => {
    isComposing = false;
    emitFromDom();
    refreshTrigger();
  };

  const minHeightStyle = () => {
    const rows = Math.max(1, Math.min(props.rows ?? 2, 12));
    return { "min-height": `${rows * 1.5}em` };
  };

  return (
    <>
      <div class="relative">
        <div
          ref={editorRef}
          data-testid="mention-textarea"
          contenteditable={!props.disabled}
          tabindex={props.disabled ? -1 : 0}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open()}
          aria-controls={open() ? listboxId : undefined}
          aria-autocomplete="list"
          aria-label={props.ariaLabel}
          aria-activedescendant={
            open() && results()[activeIdx()] ? optionId(results()[activeIdx()].id) : undefined
          }
          onInput={onInput}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onMouseUp={onMouseUp}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onBlur={() => {
            setTimeout(() => {
              if (!popupRef?.matches(":hover")) {
                close();
                props.onBlur?.();
              }
            }, 120);
          }}
          class={`${props.class ?? ""} whitespace-pre-wrap break-words outline-none`}
          style={minHeightStyle()}
        />
        <Show when={isEmpty() && props.placeholder}>
          <div
            aria-hidden="true"
            class={`${props.class ?? ""} pointer-events-none absolute inset-0 text-sm !text-zinc-500`}
          >
            {props.placeholder}
          </div>
        </Show>
      </div>

      <Show when={open()}>
        <Portal>
          <div
            ref={popupRef}
            data-testid="mention-popup"
            class="z-[120] rounded-md border border-zinc-700 bg-zinc-900/95 backdrop-blur shadow-xl overflow-hidden flex flex-col"
            style={popupStyle()}
          >
            <Show when={loading() && results().length === 0}>
              <div class="px-3 py-3 text-xs text-zinc-500 flex items-center gap-2">
                <Loader2 size={12} class="animate-spin" />
                Searching clients…
              </div>
            </Show>
            <Show when={!loading() && results().length === 0}>
              <div class="px-3 py-3 text-xs text-zinc-500" data-testid="mention-popup-empty">
                {query() ? `No clients match "${query()}"` : "Type to search clients…"}
              </div>
            </Show>
            <Show when={results().length > 0}>
              <ul
                id={listboxId}
                role="listbox"
                aria-label="Client mentions"
                class="m-0 p-0 list-none overflow-y-auto"
                style={{ "max-height": "240px" }}
              >
                <For each={results()}>
                  {(c, idx) => (
                    <li id={optionId(c.id)} role="option" aria-selected={idx() === activeIdx()}>
                      <button
                        type="button"
                        data-testid={`mention-result-${c.id}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                        }}
                        onMouseEnter={() => setActiveIdx(idx())}
                        onClick={() => insertSelected(c)}
                        class={`w-full text-left px-3 py-2 transition-colors flex items-start gap-2 cursor-pointer ${
                          idx() === activeIdx() ? "bg-amber-500/15" : "hover:bg-amber-500/10"
                        }`}
                      >
                        <UserRound size={14} class="text-zinc-500 shrink-0 mt-0.5" />
                        <span class="flex-1 min-w-0">
                          <span class="block text-sm text-zinc-100 truncate">{c.name_raw}</span>
                          <Show when={c.email || c.phone}>
                            <span class="block text-[11px] text-zinc-500 truncate">
                              {[c.email, c.phone].filter(Boolean).join(" · ")}
                            </span>
                          </Show>
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </Portal>
      </Show>
    </>
  );
}
