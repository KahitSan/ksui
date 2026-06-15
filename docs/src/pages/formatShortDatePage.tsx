import { type JSX } from "solid-js";
import FormatShortDateBasic from "../examples/format-short-date-basic";
import src from "../examples/format-short-date-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function FormatShortDatePage(): JSX.Element {
  return (
    <article>
      <h1>formatShortDate</h1>
      <p class="lead">
        A small date formatter for plugin remotes. You give it a stored date string and it returns the en-PH short form
        like <code>"Jan 5, 2026"</code>. Hilinga is an Asia/Manila product, so the date is read at local midnight to
        avoid the UTC drift that <code>toISOString</code> would cause. A missing value returns an em-dash placeholder.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { formatShortDate } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="A few inputs and their formatted results"
        description="Pure function, fully live. Each row feeds an input through formatShortDate. Plain YYYY-MM-DD and full ISO strings both render the short date; null, undefined, and empty strings return the em-dash placeholder."
        render={() => <FormatShortDateBasic />}
        code={src}
      />

      <h2>Signature</h2>
      <table class="props-table">
        <thead>
          <tr><th>Arg</th><th>Type</th><th>Returns</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>dateStr</code></td>
            <td><code>string | null | undefined</code></td>
            <td><code>string</code> (the short date, or an em-dash if missing)</td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/utils/format-short-date" />
    </article>
  );
}
