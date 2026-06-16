// example-start
import { createSignal } from "solid-js";
import { DateTile } from "@kahitsan/ksui";

export default function DateTileBasic() {
  // DateTile is a compact, domain-free day cell: a top band (here a month
  // label), a big value (the day-of-month), and an optional sub-label (here
  // hours). Give it `onToggle` to make it a selectable button; omit it for a
  // static, dimmed, read-only cell.
  const days = [
    { id: 1, value: 9, top: "MAY", sub: "10h" },
    { id: 2, value: 12, top: "MAY", sub: "4.5h" },
    { id: 3, value: 16, top: "MAY", sub: "9.5h" },
    { id: 4, value: 4, top: "JUN", sub: "9h" },
    { id: 5, value: 7, top: "JUN", sub: "9.8h" },
  ];
  const [selected, setSelected] = createSignal(new Set([1, 2, 3, 4, 5]));
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1.5rem",
      }}
    >
      {/* Interactive: a selectable row of days */}
      <div style={{ display: "flex", gap: "0.375rem", "flex-wrap": "wrap" }}>
        {days.map((d) => (
          <DateTile
            value={d.value}
            topLabel={d.top}
            subLabel={d.sub}
            selected={selected().has(d.id)}
            onToggle={() => toggle(d.id)}
          />
        ))}
      </div>

      {/* Static: read-only cells (no onToggle) */}
      <div style={{ display: "flex", gap: "0.375rem", "flex-wrap": "wrap" }}>
        <DateTile value={1} topLabel="JUL" subLabel="8h" />
        <DateTile value={2} topLabel="JUL" />
        <DateTile value="—" topLabel="JUL" subLabel="off" />
      </div>
    </div>
  );
}
