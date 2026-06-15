import { type JSX } from "solid-js";
import FormActionsBasic from "../examples/form-actions-basic";
import formActionsBasicSrc from "../examples/form-actions-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function FormActionsPage(): JSX.Element {
  return (
    <article>
      <h1>FormActions</h1>
      <p class="lead">
        The Cancel / Submit footer row that sits at the bottom of nearly every plugin modal. It composes the host{" "}
        <code>Button</code> into a <code>flex flex-col-reverse sm:flex-row</code> row: a secondary Cancel button and a
        primary submit button. The caller owns the submit handler, so no fetch or API call lives here. Labels, saving
        state, an optional leading icon, and a danger tone are all props.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { FormActions } from "@kahitsan/ksui";`} />
      </div>

      <h2>Footer variants</h2>
      <Example
        title="Footer variants"
        description="Default Save / Cancel, custom labels, a danger tone, and a disabled submit. While submitting is true the submit button disables."
        render={() => <FormActionsBasic />}
        code={formActionsBasicSrc}
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
              <code>onCancel</code>
            </td>
            <td>
              <code>() =&gt; void</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>onSubmit</code>
            </td>
            <td>
              <code>() =&gt; void</code>
            </td>
            <td>n/a (omit when <code>submitType="submit"</code>)</td>
          </tr>
          <tr>
            <td>
              <code>submitLabel</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"Save"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>cancelLabel</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"Cancel"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>submitting</code>
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
              <code>submitDisabled</code>
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
              <code>submitIcon</code>
            </td>
            <td>
              <code>JSX.Element</code>
            </td>
            <td>n/a</td>
          </tr>
          <tr>
            <td>
              <code>submitType</code>
            </td>
            <td>
              <code>"button" | "submit"</code>
            </td>
            <td>
              <code>"button"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>danger</code>
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
              <code>class</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>n/a</td>
          </tr>
        </tbody>
      </table>

      <h2>Notes</h2>
      <p>
        The submit button is disabled when either <code>submitting</code> or <code>submitDisabled</code> is true. Set{" "}
        <code>submitType="submit"</code> to let a wrapping <code>&lt;form&gt;</code> drive the action; in that case{" "}
        <code>onSubmit</code> is ignored. ModalShell is deliberately not promoted here because the host Modal already
        supplies the backdrop, card, title, close button, focus trap, and tone tokens.
      </p>

      <PageFooter path="/components/form-actions" />
    </article>
  );
}
