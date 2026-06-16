// example-start
import { createSignal } from "solid-js";
import Building from "lucide-solid/icons/building";
import Store from "lucide-solid/icons/store";
import { Dropdown, type DropdownItem } from "@kahitsan/ksui";

export default function DropdownBasic() {
  const branches: DropdownItem[] = [
    { id: "all", label: "All locations", description: "Every branch", icon: Building, badge: "Default" },
    { id: "main", label: "Main Street", description: "Open until 9 PM", status: "open" },
    { id: "north", label: "North Plaza", description: "Closed for the day", status: "closed", icon: Store },
    { id: "warehouse", label: "Warehouse", description: "Staff only", status: "neutral", disabled: true },
  ];

  const [selected, setSelected] = createSignal("all");

  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1rem",
        "align-items": "flex-start",
      }}
    >
      <Dropdown
        items={branches}
        value={selected()}
        icon={Building}
        onSelect={(item) => setSelected(item.id)}
      />
      <span style={{ "font-size": "0.8rem", opacity: "0.7" }}>Selected: {selected()}</span>

      <Dropdown items={branches} value="main" placeholder="Pick a branch" disabled />
    </div>
  );
}
