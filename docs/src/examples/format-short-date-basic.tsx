// example-start
import { For } from "solid-js";
import { formatShortDate } from "@kahitsan/ksui";

export default function FormatShortDateBasic() {
  // formatShortDate is a pure helper, so there is no trigger to click. We just
  // show what it returns for a few inputs. It turns a stored date string into
  // the en-PH short form like "Jan 5, 2026", anchored at Manila local midnight.
  const inputs = [
    "2026-01-05",
    "2026-06-16",
    "2025-12-31T14:30:00Z",
    "2026-03-01T00:00:00",
    null,
    undefined,
    "",
  ];
  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
      }}
    >
      <p class="text-zinc-400" style={{ "font-size": "0.9rem", "margin-top": 0, "margin-bottom": "1rem" }}>
        Plain YYYY-MM-DD and full ISO strings both work. The time part is dropped and the date is read at Manila local
        midnight. A missing value returns an em-dash placeholder.
      </p>
      <div style={{ display: "flex", "flex-direction": "column", gap: "0.75rem" }}>
        <For each={inputs}>
          {(input) => {
            const out = formatShortDate(input);
            return (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "1rem",
                  "flex-wrap": "wrap",
                }}
              >
                <code class="text-zinc-300" style={{ "min-width": "20rem" }}>
                  formatShortDate({JSON.stringify(input)})
                </code>
                <code class="text-zinc-500">{out}</code>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
