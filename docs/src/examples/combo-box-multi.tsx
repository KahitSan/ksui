// example-start
import { createSignal } from "solid-js";
import UserRound from "lucide-solid/icons/user-round";
import { ComboBox } from "@kahitsan/ksui";

interface Person {
  id: number;
  name: string;
  email: string;
}

// Multi-select: pass `multiple` and a `value` array. Picking a result adds a
// chip; the popup stays open so you can add several. `primaryStar` marks
// value[0] as the primary (star) and lets other chips promote to it; `invalid`
// paints the required/empty tone. Backed by an in-memory list so the demo runs
// standalone.
const PEOPLE: Person[] = [
  { id: 1, name: "Ada Lovelace", email: "ada@analytical.engine" },
  { id: 2, name: "Alan Turing", email: "alan@bletchley.uk" },
  { id: 3, name: "Grace Hopper", email: "grace@cobol.mil" },
  { id: 4, name: "Katherine Johnson", email: "katherine@nasa.gov" },
  { id: 5, name: "Margaret Hamilton", email: "margaret@apollo.nasa" },
];

export default function ComboBoxMulti() {
  const [people, setPeople] = createSignal(PEOPLE);
  const [pool, setPool] = createSignal<Person[]>([]);

  const search = (q: string) =>
    new Promise<Person[]>((resolve) =>
      setTimeout(() => {
        const needle = q.trim().toLowerCase();
        resolve(needle ? people().filter((p) => p.name.toLowerCase().includes(needle)) : people());
      }, 150),
    );

  const onCreate = (name: string) =>
    new Promise<Person>((resolve) => {
      const created: Person = { id: Date.now(), name, email: "—" };
      setPeople((list) => [...list, created]);
      setTimeout(() => resolve(created), 150);
    });

  return (
    <div
      style={{ padding: "1.5rem", "border-radius": "0.75rem", display: "flex", "flex-direction": "column", gap: "1rem" }}
    >
      <div>
        <label class="block text-xs font-medium text-zinc-400 uppercase tracking-wide">Attendees</label>
        <ComboBox<Person>
          multiple
          value={pool()}
          onChange={setPool}
          primaryStar
          invalid={pool().length === 0}
          search={search}
          onCreate={onCreate}
          idOf={(p) => p.id}
          labelOf={(p) => p.name}
          secondaryOf={(p) => p.email}
          icon={UserRound}
          noun="person"
          placeholder="Type to add people…"
        />
      </div>
      <span class="text-sm text-zinc-400">
        Primary: <span class="text-zinc-100">{pool()[0]?.name ?? "— none —"}</span>
        {pool().length > 1 ? ` (+${pool().length - 1} more)` : ""}
      </span>
    </div>
  );
}
