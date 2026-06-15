import { type JSX } from "solid-js";
import FormatFullDateBasic from "../examples/format-full-date-basic";
import src from "../examples/format-full-date-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function FormatFullDatePage(): JSX.Element {
  return (
    <article>
      <h1>formatFullDate</h1>
      <p class="lead">
        The canonical date and time formatter. Give it a timestamp and it returns{" "}
        <code>Mon D, YYYY · h:mm AM</code> in the en-PH locale. A null or empty input returns an em-dash placeholder, so
        a table cell can use the result directly without its own guard.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { formatFullDate } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Timestamps become a readable date, empty inputs become a placeholder"
        description="A timestamp formats to en-PH date and time; an empty or null input returns the em-dash placeholder."
        render={() => <FormatFullDateBasic />}
        code={src}
      />

      <h2>Signature</h2>
      <table class="props-table">
        <thead>
          <tr>
            <th>Arg</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>stamp</code>
            </td>
            <td>
              <code>string | null | undefined</code>
            </td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/utils/format-full-date" />
    </article>
  );
}
