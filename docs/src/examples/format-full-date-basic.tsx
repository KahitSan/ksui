// example-start
import { For } from "solid-js";
import { formatFullDate } from "@kahitsan/ksui";

export default function FormatFullDateBasic() {
  // formatFullDate is a pure helper, so there is no trigger to click. We just
  // show what it returns for a few inputs. It turns a timestamp into the
  // "Mon D, YYYY · h:mm AM" shape used in table cells, and gives an em-dash
  // placeholder when the input is null or empty.
  const inputs = [
    "2026-06-16T09:05:00+08:00",
    "2026-01-02T18:30:00+08:00",
    "2025-12-25T00:00:00+08:00",
    "",
    null,
  ];
  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
      }}
    >
      <p class="text-zinc-400" style={{ "font-size": "0.9rem", "margin-top": 0, "margin-bottom": "1rem" }}>
        Each row feeds a timestamp through formatFullDate. Null and empty inputs return the em-dash placeholder so a
        cell can drop the result in without its own guard.
      </p>
      <div style={{ display: "flex", "flex-direction": "column", gap: "0.75rem" }}>
        <For each={inputs}>
          {(input) => {
            const out = formatFullDate(input);
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
                  formatFullDate({JSON.stringify(input)})
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
