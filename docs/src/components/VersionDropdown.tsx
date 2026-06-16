import { createSignal, For, onCleanup, onMount, type JSX } from "solid-js";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Check from "lucide-solid/icons/check";
import ExternalLink from "lucide-solid/icons/external-link";
import { VERSIONS } from "../versions";
import { selectedVersion, setSelectedVersion } from "../versions";

// Top-bar version pill. Picking a version FILTERS the documented catalog to that
// release: the sidebar shows only what existed then and components removed since
// render with an obsolete banner. The small external-link icon on each row opens
// that version's GitHub release notes in a new tab (without changing the filter).
// Closes on outside click and on Escape.
export function VersionDropdown(): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let root: HTMLDivElement | undefined;

  function onDocClick(e: MouseEvent) {
    if (root && e.target instanceof Node && !root.contains(e.target)) {
      setOpen(false);
    }
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
  }

  onMount(() => {
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
  });
  onCleanup(() => {
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKeyDown);
  });

  function pick(version: string) {
    setSelectedVersion(version);
    setOpen(false);
  }

  return (
    <div class="version-dropdown" ref={root}>
      <button
        type="button"
        class="version-trigger"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span>v{selectedVersion()}</span>
        <ChevronDown size={14} />
      </button>
      {open() && (
        <div class="version-menu" role="menu">
          <For each={VERSIONS}>
            {(entry) => {
              const isCurrent = () => entry.version === selectedVersion();
              return (
                <div class="version-item" classList={{ current: isCurrent() }}>
                  <button
                    type="button"
                    class="version-item-pick"
                    role="menuitemradio"
                    aria-checked={isCurrent()}
                    onClick={() => pick(entry.version)}
                  >
                    <span>v{entry.version}</span>
                    {isCurrent() && <Check size={14} />}
                  </button>
                  <a
                    class="version-item-notes"
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    title={`v${entry.version} release notes`}
                    aria-label={`v${entry.version} release notes`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
              );
            }}
          </For>
        </div>
      )}
    </div>
  );
}
