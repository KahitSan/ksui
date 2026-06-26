// Tiny presentational row markers for the transactions DataTable cells.
// Extracted verbatim from index.tsx — both are pure props-driven components
// consumed by the columns render code.
//
//  - PeerUnavailable: inline ⚠️ for a cell whose display name couldn't be
//    resolved because the owning plugin (financial-accounts / payees) was
//    unavailable for the fetch. Distinguishes "couldn't load" from a genuinely
//    empty value ("—").
//  - SharedWithStack: overlapping avatar stack for a private row's share list.

import { For, Show } from "solid-js";
import { Avatar } from "@kahitsan/ksui";
import TriangleAlert from "lucide-solid/icons/triangle-alert";

export function PeerUnavailable(props: { title: string }) {
  return (
    <span
      class="inline-flex items-center text-amber-400/80"
      title={props.title}
      aria-label={props.title}
    >
      <TriangleAlert size={12} />
    </span>
  );
}

export function SharedWithStack(props: {
  people: { user_id: string; name: string; image?: string | null }[];
}) {
  const MAX = 3;
  const visible = () => props.people.slice(0, MAX);
  const extra = () => Math.max(0, props.people.length - MAX);
  const fullList = () => props.people.map((p) => p.name).join(", ");
  return (
    <span
      class="hidden sm:flex items-center -space-x-1.5 shrink-0"
      title={`Shared with: ${fullList()}`}
    >
      <For each={visible()}>
        {(p) => (
          <Avatar
            name={p.name}
            image={p.image}
            size="xs"
            class="ring-2 ring-zinc-950"
          />
        )}
      </For>
      <Show when={extra() > 0}>
        <span class="w-5 h-5 rounded-full ring-2 ring-zinc-950 bg-zinc-700 flex items-center justify-center text-[8px] font-semibold text-zinc-200 select-none">
          +{extra()}
        </span>
      </Show>
    </span>
  );
}
