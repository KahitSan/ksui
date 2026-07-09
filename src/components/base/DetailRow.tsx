// DetailRow renders a single labeled read-only field: a small muted label
// stacked above its value, with an em-dash placeholder when the value is
// empty. Used in detail/view surfaces (e.g. the client detail modal) to lay
// out a record's fields uniformly.
//
// Ported verbatim from kplugin_clients/ui/remote/index.tsx. It is purely
// presentational with no external dependencies, so the only adaptation is
// the move into the shared kit.

export default function DetailRow(props: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span class="text-xs text-[var(--ks-fg-subtle,#71717a)] block">{props.label}</span>
      <span class="text-sm text-[var(--ks-fg,#ffffff)]">{props.value || "—"}</span>
    </div>
  );
}
