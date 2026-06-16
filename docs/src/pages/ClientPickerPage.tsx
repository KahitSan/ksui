import { type JSX } from "solid-js";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

// Obsolete: ClientPicker shipped in 0.3.0 and was removed in 0.9.0 — the library
// now ships a single generic picker (ComboBox) and consumers wire the clients
// endpoint at the call site. Retained for older-version reference.
const usageSrc = `import { createSignal } from "solid-js";
import { ClientPicker } from "@kahitsan/ksui";

function ClientField() {
  const [client, setClient] = createSignal(null);
  return (
    <ClientPicker
      selected={client()}
      onChange={setClient}
      // Fetched the clients plugin's /api/clients with graceful degradation
      // and an optional create-new-client flow.
    />
  );
}`;

const migrationSrc = `import { ComboBox } from "@kahitsan/ksui";
import type { ClientOption } from "@kahitsan/ksui";

// Wire the clients endpoint yourself (search / onCreate / idOf / labelOf / icon / noun).
<ComboBox<ClientOption>
  selected={client()}
  onChange={setClient}
  search={(q) => fetch(\`/api/clients?q=\${q}\`).then((r) => r.json()).then((j) => j.data)}
  idOf={(c) => c.id}
  labelOf={(c) => c.name}
  noun="client"
/>;`;

export default function ClientPickerPage(): JSX.Element {
  return (
    <article>
      <h1>Client Picker</h1>
      <p class="lead">
        A searchable combobox preset for the client field, fetching the clients plugin's <code>/api/clients</code> with
        graceful degradation and an optional create-new-client flow. Removed in v0.9.0 in favor of the single generic{" "}
        <code>ComboBox</code>; the <code>ClientOption</code> type is still exported.
      </p>

      <h2>Import (historical)</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { ClientPicker } from "@kahitsan/ksui";`} />
      </div>

      <h2>Usage (historical)</h2>
      <CodeBlock code={usageSrc} />

      <h2>Migration</h2>
      <p>
        Use <a href="#/components/combo-box">Combo Box</a> and supply the clients endpoint at the call site. The{" "}
        <code>ClientOption</code> shape remains exported, so existing type imports keep working.
      </p>
      <CodeBlock code={migrationSrc} />

      <PageFooter path="/components/client-picker" />
    </article>
  );
}
