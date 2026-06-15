import { type JSX } from "solid-js";
import AccountIconsBasic from "../examples/account-icons-basic";
import src from "../examples/account-icons-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function AccountIconsPage(): JSX.Element {
  return (
    <article>
      <h1>Account Icon Helpers</h1>
      <p class="lead">
        A set of helpers for financial account icons. <code>getAccountIcon</code> picks the right lucide icon for an
        account (its chosen icon slug, or a type based default). <code>getAccountTone</code> gives the accent
        text/background/border colors for an account chip. <code>ACCOUNT_ICON_SLUGS</code> and{" "}
        <code>ACCOUNT_ICON_LABELS</code> are the icon choices and their friendly names for building a picker.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock
          code={`import { getAccountIcon, getAccountTone, ACCOUNT_ICON_SLUGS, ACCOUNT_ICON_LABELS, type AccountIconSlug } from "@kahitsan/ksui";`}
        />
      </div>

      <h2>Basic</h2>
      <Example
        title="Every icon slug, rendered and labelled"
        description="getAccountIcon returns a lucide-solid component you render via <Dynamic>. ACCOUNT_ICON_SLUGS lists every slug and ACCOUNT_ICON_LABELS supplies each friendly caption. getAccountTone returns the accent styling for a chip."
        render={() => <AccountIconsBasic />}
        code={src}
      />

      <h2>Helpers</h2>
      <table class="props-table">
        <thead>
          <tr><th>Export</th><th>Type</th></tr>
        </thead>
        <tbody>
          <tr><td><code>getAccountIcon(account)</code></td><td><code>(account) =&gt; IconComponent</code></td></tr>
          <tr><td><code>getAccountTone(account)</code></td><td><code>(account) =&gt; {"{ class?; style? }"}</code></td></tr>
          <tr><td><code>ACCOUNT_ICON_SLUGS</code></td><td><code>readonly string[]</code></td></tr>
          <tr><td><code>ACCOUNT_ICON_LABELS</code></td><td><code>Record&lt;AccountIconSlug, string&gt;</code></td></tr>
        </tbody>
      </table>

      <PageFooter path="/components/account-icons" />
    </article>
  );
}
