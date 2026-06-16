import { createSignal, Show, type JSX } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import Menu from "lucide-solid/icons/menu";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import { Sidebar } from "./components/Sidebar";
import { ThemeToggle } from "./components/ThemeToggle";
import { VersionDropdown } from "./components/VersionDropdown";
import { GitHubLinks } from "./components/GitHubLinks";
import { entryForPath, isObsoleteInVersion, existsInVersion } from "./registry";
import { selectedVersion } from "./versions";

// Banner shown above a component's docs when, for the selected version, that
// component has been removed from the library (obsolete) — the code example is
// retained below so older-version readers can still reference it. Also flags the
// inverse: viewing a page for a component that did not yet exist in the selected
// version.
function VersionNotice(): JSX.Element {
  const location = useLocation();
  const entry = () => entryForPath(location.pathname);
  return (
    <Show when={entry()}>
      {(e) => (
        <>
          <Show when={isObsoleteInVersion(e(), selectedVersion())}>
            <div class="version-notice obsolete" role="status">
              <TriangleAlert size={16} />
              <span>
                Obsolete since <strong>v{e().removedIn}</strong>. This component was removed from the library
                {e().replacedBy ? <> — use <strong>{e().replacedBy}</strong> instead</> : null}. The example below is kept
                for reference.
              </span>
            </div>
          </Show>
          <Show when={!existsInVersion(e(), selectedVersion())}>
            <div class="version-notice future" role="status">
              <TriangleAlert size={16} />
              <span>
                Added in <strong>v{e().addedIn}</strong>. This component did not exist in the selected version
                (v{selectedVersion()}).
              </span>
            </div>
          </Show>
        </>
      )}
    </Show>
  );
}

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
        <main class="content">
          <VersionNotice />
          {props.children}
          <footer class="site-footer">
            Created with <span class="site-footer-heart">&#9829;</span> by{" "}
            <a href="https://github.com/llupRisinglll" target="_blank" rel="noopener noreferrer">
              Luis Edward Miranda
            </a>{" "}
            for KahitSan Corp.
          </footer>
        </main>
      </div>
    </div>
  );
}
