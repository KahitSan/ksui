import ComboBox from "./ComboBox";
import Search from "lucide-solid/icons/search";

export interface SearchableOption {
  value: string | number;
  label: string;
  description?: string;
}

export interface SearchableSelectProps {
  value: string | number | null | undefined;
  options: SearchableOption[];
  onChange: (next: SearchableOption | null) => void | Promise<void>;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Simple single-select dropdown with client-side fuzzy search over a static option
 * list — a domain-free convenience wrapper over {@link ComboBox}. For richer behavior
 * (async search, create-on-the-fly, multi-select) use ComboBox directly.
 */
export default function SearchableSelect(props: SearchableSelectProps) {
  const selected = () => {
    if (props.value == null || props.value === "") return null;
    return props.options.find((o) => String(o.value) === String(props.value)) ?? null;
  };

  return (
    <ComboBox<SearchableOption>
      search={async (q) => {
        const trimmed = q.trim().toLowerCase();
        if (!trimmed) return props.options;
        return props.options.filter(
          (o) =>
            o.label.toLowerCase().includes(trimmed) ||
            (o.description?.toLowerCase().includes(trimmed) ?? false),
        );
      }}
      selected={selected()}
      onChange={(next) => props.onChange(next)}
      idOf={(o) => o.value}
      labelOf={(o) => o.label}
      secondaryOf={(o) => o.description ?? null}
      icon={Search}
      noun="option"
      placeholder={props.placeholder ?? "Select..."}
      disabled={props.disabled}
      testIdPrefix="searchable-select"
    />
  );
}
