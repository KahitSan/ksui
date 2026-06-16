// Shared popup engine for ComboBox: debounced search, viewport-aware
// positioning, and the open / click-outside / Escape lifecycle. Both the
// single- and multi-select renders drive this one engine so there is exactly
// one copy of the mechanics.

import { createEffect, createSignal, onCleanup, type JSX } from "solid-js";

const POPUP_MAX_HEIGHT = 360;
const POPUP_MIN_WIDTH = 320;
const SEARCH_DEBOUNCE_MS = 200;

// Shared popup engine: debounced search, viewport-aware positioning, and the
// open/click-outside/Escape lifecycle. Both render modes drive the SAME engine
// so there is exactly one copy of the mechanics.
export function createPickerPopup<T>(cfg: {
  search: (q: string) => Promise<T[]>;
  getAnchor: () => HTMLElement | undefined;
  getPopup: () => HTMLElement | undefined;
  /** Called after each successful results fetch (e.g. reset keyboard focus). */
  onResults?: () => void;
  /** When false, a dismiss (Escape / click-outside) only hides the popup and
   *  keeps the typed query (multi mode, whose input lives in the row). Default
   *  true clears it (single mode, whose input lives inside the popup). */
  clearOnDismiss?: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  const [results, setResults] = createSignal<T[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [popupStyle, setPopupStyle] = createSignal<JSX.CSSProperties>({});

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let activeFetchToken = 0;

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
    setError(null);
    cfg
      .search(q)
      .then((rows) => {
        if (token !== activeFetchToken) return;
        setResults(rows ?? []);
        cfg.onResults?.();
      })
      .catch((e) => {
        if (token !== activeFetchToken) return;
        setError(e instanceof Error ? e.message : "Failed to load");
        setResults([]);
      })
      .finally(() => {
        if (token !== activeFetchToken) return;
        setLoading(false);
      });
  });

  const close = () => {
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
    setResults([]);
    setError(null);
  };

  const dismiss = () => {
    if (cfg.clearOnDismiss === false) setOpen(false);
    else close();
  };

  const updatePosition = () => {
    const anchor = cfg.getAnchor();
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const vpHeight = window.innerHeight;
    const vpWidth = window.innerWidth;
    const width = Math.max(POPUP_MIN_WIDTH, rect.width);
    const spaceBelow = vpHeight - rect.bottom;
    const spaceAbove = rect.top;
    const flipUp = spaceBelow < POPUP_MAX_HEIGHT && spaceAbove > spaceBelow;
    const top = flipUp ? Math.max(8, rect.top - POPUP_MAX_HEIGHT - 4) : rect.bottom + 4;
    const maxHeight = Math.max(
      200,
      Math.min(POPUP_MAX_HEIGHT, flipUp ? spaceAbove - 12 : spaceBelow - 12),
    );
    const left = Math.min(Math.max(8, rect.left), vpWidth - width - 8);
    setPopupStyle({
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      "max-height": `${maxHeight}px`,
    });
  };

  createEffect(() => {
    if (!open()) return;
    updatePosition();

    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (cfg.getAnchor()?.contains(t)) return;
      if (cfg.getPopup()?.contains(t)) return;
      dismiss();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dismiss();
      }
    };
    const onReflow = () => updatePosition();

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc, true);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc, true);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    });
  });

  const trimmedQuery = () => query().trim();

  return {
    open,
    setOpen,
    query,
    setQuery,
    debouncedQuery,
    results,
    loading,
    creating,
    setCreating,
    error,
    setError,
    popupStyle,
    updatePosition,
    close,
    trimmedQuery,
  };
}
