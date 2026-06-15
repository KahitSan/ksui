import { type JSX } from "solid-js";
import VoucherPickerBasic from "../examples/voucher-picker-basic";
import src from "../examples/voucher-picker-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function VoucherPickerPage(): JSX.Element {
  return (
    <article>
      <h1>Voucher Picker</h1>
      <p class="lead">
        A trigger that opens a popup to pick a discount voucher for a sale. It loads vouchers from the vouchers plugin,
        splits them into ones that apply to the current cart and ones that do not, and previews the peso discount each
        gives. The exported <code>calculateDiscount</code> helper is pure and computes the discount for a voucher and a
        subtotal.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { VoucherPicker, calculateDiscount, type VoucherOption } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Controlled voucher selection"
        description="Opening the popup fetches /api/vouchers, which is not reachable here, so it shows the graceful 'couldn't load' state. The calculateDiscount line below the box runs purely and needs no backend."
        render={() => <VoucherPickerBasic />}
        code={src}
      />

      <h2>Props</h2>
      <table class="props-table">
        <thead>
          <tr><th>Prop</th><th>Type</th><th>Default</th></tr>
        </thead>
        <tbody>
          <tr><td><code>selected</code></td><td><code>VoucherOption | null</code></td><td>required</td></tr>
          <tr><td><code>onChange</code></td><td><code>(next: VoucherOption | null) =&gt; void</code></td><td>required</td></tr>
          <tr><td><code>subtotal</code></td><td><code>number</code></td><td>required</td></tr>
          <tr><td><code>packageIds</code></td><td><code>number[]</code></td><td>required</td></tr>
          <tr><td><code>disabled</code></td><td><code>boolean</code></td><td><code>false</code></td></tr>
          <tr><td><code>compact</code></td><td><code>boolean</code></td><td><code>false</code></td></tr>
        </tbody>
      </table>

      <PageFooter path="/components/voucher-picker" />
    </article>
  );
}
