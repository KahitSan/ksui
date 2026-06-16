// example-start
import { createSignal } from "solid-js";
import { ThemeToggle, type ThemeToggleValue } from "@kahitsan/ksui";

export default function ThemeToggleBasic() {
  // ThemeToggle is controlled: it owns no theme state and applies no theme.
  // The parent holds the source of truth and updates it from `onToggle`.
  const [theme, setTheme] = createSignal<ThemeToggleValue>("dark");

  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1.5rem",
      }}
    >
      <div style={{ display: "flex", gap: "1.5rem", "align-items": "center" }}>
        {/* Live, interactive */}
        <ThemeToggle value={theme()} onToggle={setTheme} />
        <code>{theme()}</code>
      </div>

      <div style={{ display: "flex", gap: "1.5rem", "align-items": "center" }}>
        {/* Both static states side by side */}
        <ThemeToggle value="dark" onToggle={() => {}} />
        <span>dark (moon active)</span>
        <ThemeToggle value="light" onToggle={() => {}} />
        <span>light (sun active)</span>
      </div>
    </div>
  );
}
