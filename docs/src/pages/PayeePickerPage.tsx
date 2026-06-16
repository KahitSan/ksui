import { type JSX } from "solid-js";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

// Obsolete: PayeePicker shipped in 0.6.0 and was removed in 0.9.0 — superseded by
// the single generic ComboBox. Retained for older-version reference.
const usageSrc = `import { createSignal } from "solid-js";
import { PayeePicker } from "@kahitsan/ksui";

function PayeeField() {
  const [payee, setPayee] = createSignal(null);
  return (
    <PayeePicker
      selected={payee()}
      onChange={setPayee}
      // Fetched the payees plugin's /api/payees with graceful degradation and
      // an optional create-new-payee flow.
    />
  );
}`;

const migrationSrc = `import { ComboBox } from "@kahitsan/ksui";
import type { PayeeOption } from "@kahitsan/ksui";

<ComboBox<PayeeOption>
  selected={payee()}
  onChange={setPayee}
  search={(q) => fetch(\`/api/payees?q=\${q}\`).then((r) => r.json()).then((j) => j.data)}
  idOf={(p) => p.id}
  labelOf={(p) => p.name}
  noun="payee"
/>;`;

export default function PayeePickerPage(): JSX.Element {
  return (
    <article>
      <h1>Payee Picker</h1>
      <p class="lead">
        A searchable combobox for the "Paid to" / "Received from" / "Payable to" field, fetching the payees plugin's{" "}
        <code>/api/payees</code> with graceful degradation and an optional create-new-payee flow. Removed in v0.9.0 in
        favor of the single generic <code>ComboBox</code>; the <code>PayeeOption</code> / <code>PayeeKind</code> types
        are still exported.
      </p>

      <h2>Import (historical)</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { PayeePicker } from "@kahitsan/ksui";`} />
      </div>

      <h2>Usage (historical)</h2>
      <CodeBlock code={usageSrc} />

      <h2>Migration</h2>
      <p>
        Use <a href="#/components/combo-box">Combo Box</a> and supply the payees endpoint at the call site. The{" "}
        <code>PayeeOption</code> and <code>PayeeKind</code> shapes remain exported, so existing type imports keep
        working.
      </p>
      <CodeBlock code={migrationSrc} />

      <PageFooter path="/components/payee-picker" />
    </article>
  );
}
