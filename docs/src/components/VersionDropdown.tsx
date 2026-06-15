import { createSignal, For, onCleanup, onMount, type JSX } from "solid-js";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Check from "lucide-solid/icons/check";
import { CURRENT_VERSION, VERSIONS } from "../versions";

// A small themed pill that shows the current version and opens a menu of every
// known version. Picking one opens that version's GitHub release tag in a new
// tab. Closes on outside click and on Escape.
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

  return (
    <div class="version-dropdown" ref={root}>
      <button
        type="button"
        class="version-trigger"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span>v{CURRENT_VERSION}</span>
        <ChevronDown size={14} />
      </button>
      {open() && (
        <div class="version-menu" role="menu">
          <For each={VERSIONS}>
            {(entry) => {
              const isCurrent = entry.version === CURRENT_VERSION;
              return (
                <a
                  class="version-item"
                  classList={{ current: isCurrent }}
                  role="menuitem"
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpen(false)}
                >
                  <span>v{entry.version}</span>
                  {isCurrent && <Check size={14} />}
                </a>
              );
            }}
          </For>
        </div>
      )}
    </div>
  );
}
