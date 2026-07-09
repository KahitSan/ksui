// Shared dedup so a component's CSS-in-JS string is appended to <head> once
// per id, no matter how many instances mount — replaces the copy-pasted
// createElement('style') pattern across ~14 components.
const injected = new Set<string>();

export function injectCSS(id: string, css: string): void {
  if (injected.has(id) || typeof document === "undefined") return;
  injected.add(id);
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}
