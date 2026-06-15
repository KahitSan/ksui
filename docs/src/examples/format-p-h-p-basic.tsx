// example-start
import { For } from "solid-js";
import { formatPHP } from "@kahitsan/ksui";

export default function FormatPHPBasic() {
  // formatPHP is a pure helper, so there is no trigger to click. We just show
  // what it returns for a few inputs. It is the one PHP currency formatter the
  // plugins share, turning a number or numeric string into an en-PH peso
  // string, and an em-dash placeholder for null, undefined, or NaN.
  const inputs: Array<string | number | null | undefined> = [
    1500,
    99.5,
    "2499.99",
    0,
    1234567.89,
    null,
    undefined,
    "not a number",
  ];
  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
      }}
    >
      <p class="text-zinc-400" style={{ "font-size": "0.9rem", "margin-top": 0, "margin-bottom": "1rem" }}>
        Numbers and numeric strings become formatted peso amounts. Null, undefined, and non-numbers return an em-dash.
      </p>
      <div style={{ display: "flex", "flex-direction": "column", gap: "0.75rem" }}>
        <For each={inputs}>
          {(input) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "1rem",
                "flex-wrap": "wrap",
              }}
            >
              <code class="text-zinc-300" style={{ "min-width": "16rem" }}>
                formatPHP({JSON.stringify(input)})
              </code>
              <code class="text-zinc-500">{formatPHP(input)}</code>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
