import { For, Show, type JSX } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { ALL_ENTRIES, groupsForVersion, isObsoleteInVersion } from "../registry";
import { selectedVersion } from "../versions";

// Flattened ordering (all versions) for Previous / Next footer links.
export const FLAT_NAV = ALL_ENTRIES;

// The nav is grouped by FUNCTION (Buttons & Actions, Forms & Inputs, Pickers,
// Data Display, Feedback & Status, Overlays, Navigation & Headers, Media &
// Content, Utilities) rather than by the internal base/composite split, and is
// filtered to the version chosen in the top-bar dropdown. Components removed
// since the selected version still appear, tagged "obsolete".
export function Sidebar(): JSX.Element {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const groups = () => groupsForVersion(selectedVersion());
  return (
    <nav class="sidebar" aria-label="Primary">
      <For each={groups()}>
        {(group) => (
          <div class="sidebar-group">
            <div class="sidebar-group-title">{group.title}</div>
            <ul class="sidebar-list">
              <For each={group.items}>
                {(item) => (
                  <li>
                    <A
                      href={item.path}
                      class="sidebar-link"
                      classList={{ active: isActive(item.path) }}
                    >
                      <span>{item.label}</span>
                      <Show when={isObsoleteInVersion(item, selectedVersion())}>
                        <span class="sidebar-badge" title={`Obsolete since v${item.removedIn}`}>
                          obsolete
                        </span>
                      </Show>
                    </A>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
    </nav>
  );
}
