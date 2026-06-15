import { type JSX } from "solid-js";
import FormFieldBasic from "../examples/form-field-basic";
import formFieldBasicSrc from "../examples/form-field-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function FormFieldPage(): JSX.Element {
  return (
    <article>
      <h1>FormField</h1>
      <p class="lead">
        A small wrapper for a labeled form control. It renders a <code>label</code> above the control, the control
        itself (passed as <code>children</code>), and an optional <code>hint</code> line below. Use it to keep labels,
        controls, and hints lined up the same way across every form.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { FormField } from "@kahitsan/ksui";`} />
      </div>

      <h2>Label, control, and hint</h2>
      <Example
        title="Label, control, and hint"
        description="Three fields. The first has just a label, the next two add a hint line below the control."
        render={() => <FormFieldBasic />}
        code={formFieldBasicSrc}
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
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>children</code>
            </td>
            <td>
              <code>JSX.Element</code>
            </td>
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>hint</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>undefined</code>
            </td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/form-field" />
    </article>
  );
}
