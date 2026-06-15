import { type JSX } from "solid-js";
import PaymentAccountPickerBasic from "../examples/payment-account-picker-basic";
import src from "../examples/payment-account-picker-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function PaymentAccountPickerPage(): JSX.Element {
  return (
    <article>
      <h1>Payment Account Picker</h1>
      <p class="lead">
        A trigger that opens a popup to choose which financial account a payment goes into. It loads the accounts you
        can access, groups them by type (cash, e-wallet, bank, external), auto picks the first one, and reports how many
        accounts loaded so the parent can disable charging when there are none.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { PaymentAccountPicker, type PaymentAccountOption } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Account selection with a count callback"
        description="On mount this fetches /api/financial-accounts, which is not reachable here, so it lands in its empty state and shows 'No accessible accounts', and the count reads 0. That offline state is what renders. With a backend it would group and auto select the first account."
        render={() => <PaymentAccountPickerBasic />}
        code={src}
      />

      <h2>Props</h2>
      <table class="props-table">
        <thead>
          <tr><th>Prop</th><th>Type</th><th>Default</th></tr>
        </thead>
        <tbody>
          <tr><td><code>selected</code></td><td><code>PaymentAccountOption | null</code></td><td>required</td></tr>
          <tr><td><code>onChange</code></td><td><code>(next: PaymentAccountOption | null) =&gt; void</code></td><td>required</td></tr>
          <tr><td><code>onCountChange</code></td><td><code>(count: number) =&gt; void</code></td><td>n/a</td></tr>
          <tr><td><code>disabled</code></td><td><code>boolean</code></td><td><code>false</code></td></tr>
        </tbody>
      </table>

      <PageFooter path="/components/payment-account-picker" />
    </article>
  );
}
