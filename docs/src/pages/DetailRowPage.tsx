import { type JSX } from "solid-js";
import DetailRowBasic from "../examples/detail-row-basic";
import detailRowBasicSrc from "../examples/detail-row-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function DetailRowPage(): JSX.Element {
  return (
    <article>
      <h1>DetailRow</h1>
      <p class="lead">
        A single labeled read-only field: a small muted label stacked above its value. When the value is empty it shows
        an em-dash placeholder so rows in a detail view stay aligned. Use it on detail and view surfaces, like a client
        detail modal, to lay out a record's fields the same way every time.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { DetailRow } from "@kahitsan/ksui";`} />
      </div>

      <h2>Labeled fields</h2>
      <Example
        title="Labeled fields"
        description="Each field is a label above its value. The last row passes an empty value, so it shows the em-dash placeholder."
        render={() => <DetailRowBasic />}
        code={detailRowBasicSrc}
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
              <code>label</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>n/a</td>
          </tr>
          <tr>
            <td>
              <code>value</code>
            </td>
            <td>
              <code>string | null | undefined</code>
            </td>
            <td>
              <code>"—"</code> when empty
            </td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/detail-row" />
    </article>
  );
}
