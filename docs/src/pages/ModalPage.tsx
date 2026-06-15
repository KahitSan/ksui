import { type JSX } from "solid-js";
import ModalBasic from "../examples/modal-basic";
import modalBasicSrc from "../examples/modal-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function ModalPage(): JSX.Element {
  return (
    <article>
      <h1>Modal</h1>
      <p class="lead">
        A caller mounted dialog. There is no <code>open</code> prop: wrap the Modal in a <code>Show</code> and it is
        mounted while visible. <code>onClose</code> fires on Escape, backdrop click, or dismissal.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { Modal } from "@kserp/host-ui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Open, close"
        description="Mounted via Show; Escape and backdrop close it."
        render={() => <ModalBasic />}
        code={modalBasicSrc}
      />

      <h2>Accessibility</h2>
      <p>
        The Modal renders with <code>role="dialog"</code> and <code>aria-modal="true"</code>. Pass{" "}
        <code>ariaLabel</code> when there is no visible heading. Escape and backdrop dismissal can be disabled with{" "}
        <code>dismissable={"{false}"}</code>.
      </p>

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
              <code>onClose</code>
            </td>
            <td>
              <code>() =&gt; void</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>size</code>
            </td>
            <td>
              <code>"sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "5xl" | "7xl"</code>
            </td>
            <td>
              <code>"md"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>tone</code>
            </td>
            <td>
              <code>"default" | "danger"</code>
            </td>
            <td>
              <code>"default"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>dismissable</code>
            </td>
            <td>
              <code>boolean</code>
            </td>
            <td>
              <code>true</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>variant</code>
            </td>
            <td>
              <code>"default" | "sheet"</code>
            </td>
            <td>
              <code>"default"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>ariaLabel</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>n/a</td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/modal" />
    </article>
  );
}
