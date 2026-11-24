import { createSignal, For } from "solid-js";
import { render } from "solid-js/web";
import { isIconName, loadIcon } from "../src/icons/registry";
import * as icons from "../src/icons";
import manifest from "../assets/icon-sources/manifest.json";

const names = manifest.groups.flatMap((group) => group.names);
const symbol = (name: string) =>
  name
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
const all = icons as Record<
  string,
  (props: {
    size?: number;
    class?: string;
    title?: string;
  }) => ReturnType<typeof icons.Search>
>;

function App() {
  const [dark, setDark] = createSignal(false);
  const [filled, setFilled] = createSignal(false);
  const [selected, setSelected] = createSignal("");
  const [lookup, setLookup] = createSignal("");
  return (
    <main classList={{ dark: dark() }}>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; font: 14px system-ui, sans-serif; }
        main { color: #171717; background: #fff; min-height: 100vh; padding: 20px; }
        main.dark { color: #f5f5f5; background: #111; }
        header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 16px; }
        h1 { margin: 0; font-size: 18px; }
        button { color: inherit; background: transparent; border: 1px solid #888; padding: 8px 12px; cursor: pointer; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }
        .sample { border: 1px solid #8885; padding: 10px; min-height: 92px; }
        .sample[data-selected=true] { color: #0969da; border-color: currentColor; }
        .samples { display: flex; align-items: center; justify-content: space-around; height: 52px; gap: 8px; }
        .name { display: block; margin-top: 6px; font-size: 11px; overflow-wrap: anywhere; }
        .spinner { animation: spin 1s linear infinite; transform-origin: center; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media(prefers-reduced-motion: reduce) { .spinner { animation: none; } }
      `}</style>
      <header>
        <h1>Original icons</h1>
        <button onClick={() => setDark(!dark())}>Toggle theme</button>
        <button onClick={() => setFilled(!filled())}>Toggle star fill</button>
        <icons.Star
          size={24}
          fill={filled() ? "currentColor" : "none"}
          title="Preferred"
        />
        <icons.Check size={12} strokeWidth={3} title="Bold check" />
        <icons.LoaderCircle size={20} class="spinner" title="Loading" />
        <input
          aria-label="Icon lookup"
          value={lookup()}
          onInput={(event) => setLookup(event.currentTarget.value)}
        />
        <button
          onClick={async () => {
            const icon = await loadIcon(lookup());
            setSelected(icon && isIconName(lookup()) ? lookup() : "unknown");
          }}
        >
          Look up icon
        </button>
        <output aria-live="polite">{selected()}</output>
      </header>
      <div class="grid">
        <For each={names}>
          {(name) => {
            const Icon = all[symbol(name)];
            return (
              <button
                class="sample"
                data-icon-name={name}
                data-selected={selected() === name}
                onClick={() => setSelected(name)}
              >
                <span class="samples">
                  <Icon size={12} />
                  <Icon size={24} />
                  <Icon size={48} />
                </span>
                <span class="name">{name}</span>
              </button>
            );
          }}
        </For>
      </div>
    </main>
  );
}

export function mountIconLab() {
  render(() => <App />, document.getElementById("app")!);
}
