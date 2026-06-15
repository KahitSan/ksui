import { createSignal, Show, type JSX } from "solid-js";
import { A } from "@solidjs/router";
import Menu from "lucide-solid/icons/menu";
import { Sidebar } from "./components/Sidebar";
import { ThemeToggle } from "./components/ThemeToggle";
import { VersionDropdown } from "./components/VersionDropdown";
import { GitHubLinks } from "./components/GitHubLinks";

// The app shell: top header bar, left sidebar nav, content area. The route's
// page renders into props.children.
export function App(props: { children?: JSX.Element }): JSX.Element {
  const [navOpen, setNavOpen] = createSignal(false);
  return (
    <div class="layout">
      <header class="topbar">
        <button
          class="topbar-menu"
          type="button"
          aria-label="Toggle navigation"
          onClick={() => setNavOpen(!navOpen())}
        >
          <Menu size={20} />
        </button>
        <A href="/" class="brand">
          KS<span class="brand-accent">UI</span>
        </A>
        <span class="brand-sub">Docs</span>
        <VersionDropdown />
        <div class="topbar-spacer" />
        <ThemeToggle />
        <GitHubLinks />
      </header>
      <div class="body">
        <aside class="sidebar-wrap" classList={{ open: navOpen() }} onClick={() => setNavOpen(false)}>
          <Sidebar />
        </aside>
        <Show when={navOpen()}>
          <div class="scrim" onClick={() => setNavOpen(false)} />
        </Show>
        <main class="content">{props.children}</main>
      </div>
    </div>
  );
}
