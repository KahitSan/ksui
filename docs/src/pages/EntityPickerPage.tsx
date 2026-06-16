import { type JSX } from "solid-js";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

// Obsolete: EntityPicker shipped in 0.8.0 and was renamed to ComboBox in 0.10.0.
// The page is retained (per the version-filter rule) so older-version readers
// keep the example. The "Obsolete since" banner is rendered by App's
// VersionNotice from the registry entry.
const usageSrc = `import { createSignal } from "solid-js";
import UserRound from "lucide-solid/icons/user-round";
import { EntityPicker } from "@kahitsan/ksui";

function AssigneeField() {
  const [selected, setSelected] = createSignal(null);
  return (
    <EntityPicker
      selected={selected()}
      onChange={setSelected}
      search={searchPeople}
      onCreate={createPerson}
      idOf={(p) => p.id}
      labelOf={(p) => p.name}
      secondaryOf={(p) => p.email}
      icon={UserRound}
      noun="person"
    />
  );
}`;

export default function EntityPickerPage(): JSX.Element {
  return (
    <article>
      <h1>Entity Picker</h1>
      <p class="lead">
        The generic searchable-combobox engine: a trigger + portal popup with debounced search, viewport-aware
        positioning, inline create, and graceful degradation. Renamed to <code>ComboBox</code> in v0.10.0 (which also
        added a multi-select mode); the single-select API is unchanged.
      </p>

      <h2>Import (historical)</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { EntityPicker } from "@kahitsan/ksui";`} />
      </div>

      <h2>Usage (historical)</h2>
      <CodeBlock code={usageSrc} />

      <h2>Migration</h2>
      <p>
        Replace <code>EntityPicker</code> with <code>ComboBox</code> — the props are identical for the single-select
        case (only the component and type names changed: <code>ComboBox</code>, <code>ComboBoxProps</code>,{" "}
        <code>ComboBoxSingleProps</code>, <code>ComboBoxMultiProps</code>). See the{" "}
        <a href="#/components/combo-box">Combo Box</a> page.
      </p>

      <PageFooter path="/components/entity-picker" />
    </article>
  );
}
