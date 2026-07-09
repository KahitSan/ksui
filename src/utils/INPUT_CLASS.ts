// Shared Tailwind class string for text inputs across plugin forms: a
// full-width rounded input with the themed input surface and the amber focus
// ring. Copied verbatim from the packages remote UI atoms so the shared kit
// owns the single source of truth. Pure string constant, no dependencies.
//
// bg reads --ks-input-bg (not --ks-border, THEME-SPEC §1.2's dedicated input
// surface token) — the border token happens to be a plausible dark literal so
// this silently looked right in the `dark` theme and only broke elsewhere.
export const INPUT_CLASS =
  "w-full rounded-lg border border-[var(--ks-input-border,#3f3f46)] bg-[var(--ks-input-bg,#18181b)] px-3 py-2 text-sm text-[var(--ks-fg,#ffffff)] focus:border-[color-mix(in_srgb,var(--ks-focus-ring,#c9a961)_50%,transparent)] focus:outline-none";
