// Column-cell rendering for the spec-driven datatable. One pure function maps a
// UiColumn's declared render hint to the exact JSX hand-written payees ships, so
// the generated table is byte-for-behavior identical.
import type { JSX } from "solid-js";
import StatusPill from "../../base/StatusPill";
import type { ResourceRow, ResourceUiSpec, UiColumn } from "./spec";

/** Render a single cell for `column` from `row`. `onTitleClick` opens detail. */
export function renderCell(
  spec: ResourceUiSpec,
  column: UiColumn,
  row: ResourceRow,
  onTitleClick: (id: number) => void,
): JSX.Element | string {
  const r = column.render;
  const raw = row[column.key];
  switch (r.type) {
    case "title":
      return (
        <button
          data-testid={`${spec.testIdPrefix}-row-${row.id}`}
          class="text-left text-zinc-200 hover:text-amber-400 transition-colors cursor-pointer"
          onClick={() => onTitleClick(row.id)}
        >
          {String(raw ?? "")}
        </button>
      );
    case "enum": {
      const key = String(raw ?? "");
      return <span class="text-zinc-400 text-sm capitalize">{r.labels[key] || key}</span>;
    }
    case "status": {
      const active = Boolean(raw);
      const arm = active ? r.active : r.inactive;
      return <StatusPill label={arm.label} tone={arm.tone} dot solid />;
    }
    case "text":
    default: {
      const cls = (r.type === "text" && r.muted) ? "text-zinc-500 text-sm" : "text-zinc-400 text-sm";
      const text = raw === null || raw === undefined || raw === "" ? "—" : String(raw);
      return <span class={cls}>{text}</span>;
    }
  }
}
