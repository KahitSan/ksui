import { createSignal, For, type JSX } from "solid-js";
import { CodeBlock } from "./CodeBlock";

const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
type Manager = (typeof MANAGERS)[number];

// Package manager install tabs with a copy button on the rendered command.
export function PackageManagerTabs(props: { pkg: string }): JSX.Element {
  const [active, setActive] = createSignal<Manager>("npm");
  const cmd = (m: Manager) => {
    switch (m) {
      case "npm":
        return `npm install ${props.pkg}`;
      case "pnpm":
        return `pnpm add ${props.pkg}`;
      case "yarn":
        return `yarn add ${props.pkg}`;
      case "bun":
        return `bun add ${props.pkg}`;
    }
  };
  return (
    <div>
      <div class="pm-tabs">
        <For each={MANAGERS}>
          {(m) => (
            <button
              class="pm-tab"
              classList={{ active: active() === m }}
              type="button"
              onClick={() => setActive(m)}
            >
              {m}
            </button>
          )}
        </For>
      </div>
      <CodeBlock code={cmd(active())} lang="bash" />
    </div>
  );
}
