// example-start
import { createSignal } from "solid-js";
import UserRound from "lucide-solid/icons/user-round";
import { ComboBox } from "@kahitsan/ksui";

interface Person {
  id: number;
  name: string;
  email: string;
}

// ComboBox is domain-free: you provide the data (search / onCreate) and the
// display (idOf / labelOf / secondaryOf / icon / noun). Here we back it with an
// in-memory list instead of a plugin API, so the demo runs standalone.
const PEOPLE: Person[] = [
  { id: 1, name: "Ada Lovelace", email: "ada@analytical.engine" },
  { id: 2, name: "Alan Turing", email: "alan@bletchley.uk" },
  { id: 3, name: "Grace Hopper", email: "grace@cobol.mil" },
  { id: 4, name: "Katherine Johnson", email: "katherine@nasa.gov" },
];

export default function ComboBoxBasic() {
  const [people, setPeople] = createSignal(PEOPLE);
  const [selected, setSelected] = createSignal<Person | null>(null);

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
        <label class="block text-xs font-medium text-zinc-400 uppercase tracking-wide">Assignee</label>
        <ComboBox<Person>
          selected={selected()}
          onChange={setSelected}
          search={search}
          onCreate={onCreate}
          idOf={(p) => p.id}
          labelOf={(p) => p.name}
          secondaryOf={(p) => p.email}
          icon={UserRound}
          noun="person"
          placeholder="Pick a person…"
        />
      </div>
      <span class="text-sm text-zinc-400">
        Selected: <span class="text-zinc-100">{selected()?.name ?? "— none —"}</span>
      </span>
    </div>
  );
}
