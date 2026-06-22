// The spec-driven read-only detail view (the non-editing face of the detail
// modal). Renders one ksui DetailRow per declared detail row, deriving each
// value by its kind (raw field / enum label / status / formatted datetime),
// reproducing hand-written payees' PayeeDetail.
import { For } from "solid-js";
import DetailRow from "../../base/DetailRow";
import type { ResourceRow, UiDetailRow, UiDetailValue } from "./spec";

function detailValue(row: ResourceRow, value: UiDetailValue): string | null {
  const raw = row[value.key];
  switch (value.type) {
    case "enum": {
      const key = String(raw ?? "");
      return value.labels[key] || key;
    }
    case "status":
      return raw ? value.active : value.inactive;
    case "datetime":
      return raw ? new Date(String(raw)).toLocaleString() : null;
    case "field":
    default:
      return raw === null || raw === undefined ? null : String(raw);
  }
}

export function ResourceDetail(props: { rows: readonly UiDetailRow[]; row: ResourceRow }) {
  return (
    <div class="space-y-4">
      <For each={props.rows}>
        {(r) => <DetailRow label={r.label} value={detailValue(props.row, r.value)} />}
      </For>
    </div>
  );
}
