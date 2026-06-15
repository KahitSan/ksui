// example-start
import { For } from "solid-js";
import { buildLogoSrc } from "@kahitsan/ksui";

export default function BuildLogoSrcBasic() {
  // buildLogoSrc is a pure helper, so there is no trigger to click. We just
  // show what it returns for a few inputs. It backs the account logo <img>.
  const inputs = [
    "https://picsum.photos/seed/logo/80/80",
    "http://example.com/logo.png",
    "javascript:alert(1)",
    "/relative/path.png",
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
        Only http(s) links survive. Everything else returns an empty string, so the img renders nothing.
      </p>
      <div style={{ display: "flex", "flex-direction": "column", gap: "0.75rem" }}>
        <For each={inputs}>
          {(input) => {
            const out = buildLogoSrc(input);
            return (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "1rem",
                  "flex-wrap": "wrap",
                }}
              >
                <code class="text-zinc-300" style={{ "min-width": "16rem" }}>
                  buildLogoSrc({JSON.stringify(input)})
                </code>
                <code class="text-zinc-500">{out || "(empty)"}</code>
                <img
                  src={out}
                  alt=""
                  width={28}
                  height={28}
                  style={{ "object-fit": "cover", "border-radius": "0.25rem" }}
                />
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
