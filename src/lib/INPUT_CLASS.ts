// Shared Tailwind class string for text inputs across plugin forms: a
// full-width rounded input with the dark zinc surface and the amber focus
// ring. Copied verbatim from the packages remote UI atoms so the shared kit
// owns the single source of truth. Pure string constant, no dependencies.

export const INPUT_CLASS =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500/50 focus:outline-none";
