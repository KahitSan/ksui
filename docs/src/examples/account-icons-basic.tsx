// example-start
import { For } from "solid-js";
import { Dynamic } from "solid-js/web";
import { getAccountIcon, getAccountTone, ACCOUNT_ICON_SLUGS, ACCOUNT_ICON_LABELS } from "@kahitsan/ksui";

export default function AccountIconsBasic() {
  // These are pure helpers: no trigger to press. We show each icon slug the
  // way it appears in the app so the lucide glyphs and the per-type tone
  // chips read true.
  const tone = getAccountTone({ type: "bank", color: "#0ea5e9" });
  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1.25rem",
      }}
    >
      <p class="text-zinc-400" style={{ "font-size": "0.9rem", margin: 0 }}>
        Every icon slug from ACCOUNT_ICON_SLUGS, each rendered via getAccountIcon and labelled by
        ACCOUNT_ICON_LABELS.
      </p>
      <div style={{ display: "flex", "flex-wrap": "wrap", gap: "1rem" }}>
        <For each={ACCOUNT_ICON_SLUGS}>
          {(slug) => {
            const Icon = getAccountIcon({ type: "bank", icon: slug });
            return (
              <div class="text-zinc-200" style={{ "text-align": "center", width: "72px" }}>
                <Dynamic component={Icon} size={24} />
                <p class="text-zinc-400" style={{ "margin-top": "0.35rem", "font-size": "0.7rem" }}>
                  {ACCOUNT_ICON_LABELS[slug]}
                </p>
              </div>
            );
          }}
        </For>
      </div>
      <p class="text-zinc-400" style={{ "font-size": "0.85rem", margin: 0 }}>
        getAccountTone for a bank with a sky color returns:{" "}
        <code class="text-zinc-200">{JSON.stringify(tone.style ?? tone.class ?? {})}</code>
      </p>
    </div>
  );
}
