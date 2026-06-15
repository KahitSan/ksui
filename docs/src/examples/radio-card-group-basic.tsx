// example-start
import { createSignal } from "solid-js";
import { RadioCardGroup } from "@kahitsan/ksui";

interface Plan {
  id: string;
  name: string;
  price: string;
}

const PLANS: Plan[] = [
  { id: "starter", name: "Starter", price: "Free" },
  { id: "team", name: "Team", price: "P499 / mo" },
  { id: "business", name: "Business", price: "P1,499 / mo" },
];

export default function RadioCardGroupBasic() {
  // Controlled selection: the group does not hold its own state, so we keep
  // the chosen key in a signal and hand it back through value + onChange.
  const [selected, setSelected] = createSignal<string | null>("team");

  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1rem",
      }}
    >
      <RadioCardGroup
        ariaLabel="Choose a plan"
        options={PLANS}
        value={selected()}
        onChange={setSelected}
        keyOf={(p) => p.id}
        renderOption={(p, isSelected) => (
          <span style={{ display: "flex", "flex-direction": "column", gap: "0.15rem" }}>
            <span style={{ "font-weight": isSelected ? "600" : "500" }}>{p.name}</span>
            <span style={{ "font-size": "0.8rem", opacity: "0.75" }}>{p.price}</span>
          </span>
        )}
      />
      <p style={{ "font-size": "0.85rem", opacity: "0.75", margin: "0" }}>
        Selected key: <code>{selected() ?? "none"}</code>. Try the arrow keys, Home, and End to move.
      </p>
    </div>
  );
}
