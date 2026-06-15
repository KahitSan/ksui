import { type JSX } from "solid-js";
import FormatPHPBasic from "../examples/format-p-h-p-basic";
import src from "../examples/format-p-h-p-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function FormatPHPPage(): JSX.Element {
  return (
    <article>
      <h1>formatPHP</h1>
      <p class="lead">
        The one Philippine peso formatter every plugin shares. You give it a number or a numeric string and it returns
        an en-PH peso amount. If you pass <code>null</code>, <code>undefined</code>, or something that is not a number,
        it returns an em-dash placeholder so a table cell never shows <code>NaN</code>.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { formatPHP } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="A few amounts and their formatted results"
        description="Pure function, fully live. Each row feeds an input through formatPHP and shows what comes back. Numbers and numeric strings become peso amounts; null, undefined, and non-numbers return an em-dash."
        render={() => <FormatPHPBasic />}
        code={src}
      />

      <h2>Signature</h2>
      <table class="props-table">
        <thead>
          <tr><th>Arg</th><th>Type</th></tr>
        </thead>
        <tbody>
          <tr><td><code>amount</code></td><td><code>string | number | null | undefined</code></td></tr>
        </tbody>
      </table>

      <PageFooter path="/utils/format-php" />
    </article>
  );
}
