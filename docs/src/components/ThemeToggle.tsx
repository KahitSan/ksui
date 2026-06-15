import { createSignal, Show, onMount, type JSX } from "solid-js";
import Sun from "lucide-solid/icons/sun";
import Moon from "lucide-solid/icons/moon";

// The docs mirror the real app's theme switch exactly. The app holds a single
// theme in localStorage under "ks-erp-theme" and toggles a class on the <html>
// element: "dark" or "light". Dark is the default and most styling lives there;
// the ".light" class carries the light remaps. We do the same here so both the
// docs chrome AND the live component previews flip together.

export const THEME_KEY = "ks-erp-theme";
export type Theme = "dark" | "light";

// Read the saved theme. If nothing is saved, fall back to the system
// preference, then to the app default of dark.
export function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // localStorage can throw in some locked-down browsers. Ignore and fall
    // through to system preference.
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

// Set the two mutually exclusive classes on <html> to match the active theme.
export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === "light") {
    root.classList.add("light");
    root.classList.remove("dark");
  } else {
    root.classList.add("dark");
    root.classList.remove("light");
  }
}

export function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = createSignal<Theme>(readInitialTheme());

  // The pre-render bootstrap already set the class, but sync our signal to the
  // real DOM state on mount in case anything changed before hydration.
  onMount(() => {
    const current: Theme = document.documentElement.classList.contains("light")
      ? "light"
      : "dark";
    setTheme(current);
  });

  function toggle() {
    const next: Theme = theme() === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Saving is best effort. The toggle still works for this session.
    }
  }

  return (
    <button
      class="theme-toggle"
      type="button"
      onClick={toggle}
      aria-label={theme() === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme() === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      <Show when={theme() === "dark"} fallback={<Moon size={18} />}>
        <Sun size={18} />
      </Show>
    </button>
  );
}
