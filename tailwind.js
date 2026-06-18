/**
 * @kahitsan/ksui Tailwind CSS plugin
 *
 * Registers all ksui component utility classes so consumers don't need
 * @source directives or manual safelisting. Add to your Tailwind config:
 *
 *   // tailwind.config.js (v3)
 *   plugins: [require("@kahitsan/ksui/tailwind")]
 *
 *   // app.css (v4)
 *   @plugin "@kahitsan/ksui/tailwind";
 *
 * The plugin safelists every Tailwind utility class that ksui components
 * reference in their source, ensuring they survive Tailwind's purge/scan
 * even though the class strings live in node_modules.
 */

/** @type {import('tailwindcss').Plugin} */
module.exports = function ksuiTailwindPlugin({ addUtilities, addComponents }) {
  // ─── Button intents ────────────────────────────────────────────────
  // Primary (amber)
  addUtilities({
    ".ks-btn-primary": {
      color: "rgb(251 191 36)",           // text-amber-400
      "background-color": "rgba(217 119 6 / 0.2)",  // bg-amber-600/20
      border: "1px solid rgba(217 119 6 / 0.6)",     // border-amber-600/60
    },
    ".ks-btn-primary:hover": {
      "background-color": "rgba(217 119 6 / 0.3)",  // hover:bg-amber-600/30
      "border-color": "rgb(245 158 11)",              // hover:border-amber-500
    },
  });

  // Danger (red)
  addUtilities({
    ".ks-btn-danger": {
      color: "rgb(248 113 113)",           // text-red-400
      "background-color": "rgba(220 38 38 / 0.2)",   // bg-red-600/20
      border: "1px solid rgba(220 38 38 / 0.6)",     // border-red-600/60
    },
    ".ks-btn-danger:hover": {
      "background-color": "rgba(220 38 38 / 0.3)",   // hover:bg-red-600/30
      "border-color": "rgb(239 68 68)",               // hover:border-red-500
    },
  });

  // Secondary (slate)
  addUtilities({
    ".ks-btn-secondary": {
      color: "rgb(148 163 184)",           // text-slate-400
      "background-color": "rgba(71 85 105 / 0.2)",   // bg-slate-600/20
      border: "1px solid rgba(71 85 105 / 0.6)",     // border-slate-600/60
    },
    ".ks-btn-secondary:hover": {
      "background-color": "rgba(71 85 105 / 0.3)",   // hover:bg-slate-600/30
      "border-color": "rgb(100 116 139)",             // hover:border-slate-500
    },
  });

  // Ghost
  addUtilities({
    ".ks-btn-ghost": {
      "background-color": "transparent",
      border: "1px solid transparent",
    },
    ".ks-btn-ghost:hover": {
      "background-color": "rgb(255 255 255 / 0.1)",  // hover:bg-current/10
    },
  });

  // Link
  addUtilities({
    ".ks-btn-link": {
      "background-color": "transparent",
      border: "none",
      "text-decoration": "underline",
      "text-underline-offset": "4px",
    },
    ".ks-btn-link:hover": {
      "background-color": "transparent",
    },
  });

  // ─── Button base ───────────────────────────────────────────────────
  addComponents({
    ".ks-btn": {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      gap: "0.5rem",
      "font-weight": 500,
      "font-size": "0.875rem",
      "line-height": "1.25rem",
      "border-radius": "0.25rem",
      padding: "0.5rem 1rem",
      "user-select": "none",
      transition: "all 0.15s ease",
      outline: "none",
    },
    ".ks-btn:focus-visible": {
      "outline": "2px solid rgb(217 119 6 / 0.5)",
      "outline-offset": "2px",
    },
    ".ks-btn:disabled": {
      opacity: 0.5,
      cursor: "not-allowed",
    },
    ".ks-btn-sm": {
      "font-size": "0.75rem",
      padding: "0.375rem 0.75rem",
    },
    ".ks-btn-lg": {
      "font-size": "1rem",
      padding: "0.625rem 1.25rem",
    },
  });

  // ─── DataTable ─────────────────────────────────────────────────────
  addComponents({
    ".ks-dt": {
      "font-size": "0.875rem",
      "line-height": "1.25rem",
    },
    ".ks-dt-header": {
      display: "flex",
      "align-items": "center",
      gap: "0.5rem",
      padding: "0.75rem 1rem",
      "border-bottom": "1px solid rgb(39 39 42 / 0.6)",
    },
    ".ks-dt-search": {
      display: "flex",
      "align-items": "center",
      gap: "0.5rem",
      padding: "0.375rem 0.75rem",
      "background-color": "rgb(24 24 27)",
      border: "1px solid rgb(63 63 70 / 0.6)",
      "border-radius": "0.25rem",
      color: "rgb(228 228 231)",
      "font-size": "0.875rem",
    },
    ".ks-dt-search:focus": {
      outline: "none",
      "border-color": "rgb(217 119 6 / 0.5)",
    },
    ".ks-dt-table": {
      width: "100%",
      "border-collapse": "collapse",
    },
    ".ks-dt-th": {
      padding: "0.5rem 1rem",
      "text-align": "left",
      "font-weight": 500,
      color: "rgb(161 161 170)",
      "font-size": "0.75rem",
      "text-transform": "uppercase",
      "letter-spacing": "0.05em",
      "border-bottom": "1px solid rgb(39 39 42 / 0.6)",
      cursor: "pointer",
      "user-select": "none",
    },
    ".ks-dt-td": {
      padding: "0.625rem 1rem",
      "border-bottom": "1px solid rgb(39 39 42 / 0.3)",
      color: "rgb(228 228 231)",
    },
    ".ks-dt-empty": {
      padding: "2rem",
      "text-align": "center",
      color: "rgb(113 113 122)",
    },
    ".ks-dt-pager": {
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      padding: "0.75rem 1rem",
      "border-top": "1px solid rgb(39 39 42 / 0.6)",
      "font-size": "0.8125rem",
      color: "rgb(161 161 170)",
    },
  });

  // ─── Modal ─────────────────────────────────────────────────────────
  addComponents({
    ".ks-modal-backdrop": {
      position: "fixed",
      inset: 0,
      "background-color": "rgba(0, 0, 0, 0.6)",
      "z-index": 50,
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      padding: "1rem",
    },
    ".ks-modal-card": {
      "background-color": "rgb(24 24 27)",
      border: "1px solid rgb(63 63 70 / 0.6)",
      "max-height": "calc(100vh - 2rem)",
      overflow: "auto",
      position: "relative",
    },
    ".ks-modal-sm": { "max-width": "24rem" },
    ".ks-modal-md": { "max-width": "32rem" },
    ".ks-modal-lg": { "max-width": "40rem" },
    ".ks-modal-xl": { "max-width": "50rem" },
  });

  // ─── FormErrorBanner ───────────────────────────────────────────────
  addComponents({
    ".ks-form-error": {
      padding: "0.5rem 0.75rem",
      "background-color": "rgba(239 68 68 / 0.1)",
      border: "1px solid rgba(239 68 68 / 0.3)",
      color: "rgb(248 113 113)",
      "font-size": "0.75rem",
      "border-radius": "0.375rem",
    },
  });

  // ─── StatusPill ────────────────────────────────────────────────────
  addComponents({
    ".ks-pill": {
      display: "inline-flex",
      "align-items": "center",
      gap: "0.25rem",
      padding: "0.125rem 0.5rem",
      "font-size": "0.75rem",
      "font-weight": 500,
      "border-radius": "9999px",
    },
    ".ks-pill-success": {
      color: "rgb(74 222 128)",
      "background-color": "rgba(74 222 128 / 0.1)",
    },
    ".ks-pill-danger": {
      color: "rgb(248 113 113)",
      "background-color": "rgba(239 68 68 / 0.1)",
    },
    ".ks-pill-warning": {
      color: "rgb(251 191 36)",
      "background-color": "rgba(245 158 11 / 0.1)",
    },
    ".ks-pill-info": {
      color: "rgb(96 165 250)",
      "background-color": "rgba(59 130 246 / 0.1)",
    },
    ".ks-pill-neutral": {
      color: "rgb(161 161 170)",
      "background-color": "rgb(63 63 70 / 0.3)",
    },
  });

  // ─── CopyButton ────────────────────────────────────────────────────
  addComponents({
    ".ks-copy-btn": {
      display: "inline-flex",
      "align-items": "center",
      gap: "0.25rem",
      padding: "0.25rem 0.5rem",
      "font-size": "0.75rem",
      color: "rgb(161 161 170)",
      "background-color": "transparent",
      border: "1px solid rgb(63 63 70 / 0.6)",
      "border-radius": "0.25rem",
      cursor: "pointer",
      transition: "all 0.15s ease",
    },
    ".ks-copy-btn:hover": {
      color: "rgb(228 228 231)",
      "border-color": "rgb(82 82 91)",
    },
  });
};

module.exports.meta = {
  name: "@kahitsan/ksui",
};
