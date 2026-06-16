import { type JSX } from "solid-js";
import PayeePickerBasic from "../examples/payee-picker-basic";
import payeePickerSrc from "../examples/payee-picker-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function PayeePickerPage(): JSX.Element {
  return (
    <article>
      <h1>Payee Picker</h1>
      <p class="lead">
        A searchable combobox for the "Paid to" / "Received from" / "Payable to" field, searching the sibling payees
        plugin at <code>/api/payees</code>. It supports an optional create-new-payee flow, and degrades gracefully: when
        the payees plugin is not deployed the popup shows an inline notice and a free-text fallback (<code>selectedName</code>)
        keeps the trigger usable, so the form still saves. A composite ERP picker alongside <code>ClientPicker</code> and{" "}
        <code>VoucherPicker</code>.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { PayeePicker, type PayeeOption } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Controlled selection"
        description="The selected payee is controlled through selected and onChange. selectedName provides a free-text fallback shown in the trigger when nothing is picked. Typing filters the list (debounced); when no match exists the popup offers to create a new payee."
        render={() => <PayeePickerBasic />}
        code={payeePickerSrc}
      />

      <h2>Props</h2>
      <table class="props-table">
        <thead>
          <tr>
            <th>Prop</th>
            <th>Type</th>
            <th>Default</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>selected</code>
            </td>
            <td>
              <code>PayeeOption | null</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>onChange</code>
            </td>
            <td>
              <code>(next: PayeeOption | null) =&gt; void</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>selectedName</code>
            </td>
            <td>
              <code>string | null</code>
            </td>
            <td>
              <code>undefined</code> (free-text fallback shown in the trigger)
            </td>
          </tr>
          <tr>
            <td>
              <code>kind</code>
            </td>
            <td>
              <code>"vendor" | "customer" | "both"</code>
            </td>
            <td>
              <code>undefined</code> (filters which payees the search returns)
            </td>
          </tr>
          <tr>
            <td>
              <code>createAsKind</code>
            </td>
            <td>
              <code>"vendor" | "customer" | "both"</code>
            </td>
            <td>
              <code>undefined</code> (kind used when creating a new payee)
            </td>
          </tr>
          <tr>
            <td>
              <code>placeholder</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>undefined</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>disabled</code>
            </td>
            <td>
              <code>boolean</code>
            </td>
            <td>
              <code>false</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>testIdPrefix</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"payee-picker"</code>
            </td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/payee-picker" />
    </article>
  );
}
