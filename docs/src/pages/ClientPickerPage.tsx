import { type JSX } from "solid-js";
import ClientPickerBasic from "../examples/client-picker-basic";
import clientPickerSrc from "../examples/client-picker-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function ClientPickerPage(): JSX.Element {
  return (
    <article>
      <h1>Client Picker</h1>
      <p class="lead">
        Selects a client for a form field, searching the sibling clients plugin at <code>/api/clients</code>. When the
        clients plugin is not deployed the popup shows an inline notice and the rest of the form keeps working.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { ClientPicker, type ClientOption } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Controlled selection"
        description="The selected client is controlled by the caller through selected and onChange. When the clients plugin is unreachable the popup shows its fallback notice instead of an empty list."
        render={() => <ClientPickerBasic />}
        code={clientPickerSrc}
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
              <code>ClientOption | null</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>onChange</code>
            </td>
            <td>
              <code>(next: ClientOption | null) =&gt; void</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>onCreate</code>
            </td>
            <td>
              <code>(created: ClientOption) =&gt; void</code>
            </td>
            <td>n/a</td>
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
              <code>defaultOpen</code>
            </td>
            <td>
              <code>boolean</code>
            </td>
            <td>
              <code>false</code>
            </td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/client-picker" />
    </article>
  );
}
