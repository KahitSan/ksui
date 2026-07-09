// Shared Tailwind class string for text inputs across plugin forms: a
// full-width rounded input with the dark zinc surface and the amber focus
// ring. Copied verbatim from the packages remote UI atoms so the shared kit
// owns the single source of truth. Pure string constant, no dependencies.

export const INPUT_CLASS =
  "w-full rounded-lg border border-[var(--ks-input-border,#3f3f46)] bg-[rgba(39,39,42,0.5)] px-3 py-2 text-sm text-[#e4e4e7] focus:border-[rgba(245,158,11,0.5)] focus:outline-none";
