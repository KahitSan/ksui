import { type JSX } from "solid-js";
import CopyButtonBasic from "../examples/copy-button-basic";
import copyButtonBasicSrc from "../examples/copy-button-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function CopyButtonPage(): JSX.Element {
  return (
    <article>
      <h1>CopyButton</h1>
      <p class="lead">
        A small, self-contained copy-to-clipboard button. You pass it the <code>text</code> to copy, and it owns
        everything else. On click it writes the text to the clipboard, flips to the copied label with a check icon for
        about 1.5 seconds, then returns to its normal state. The pending timer is cleared on cleanup, so a copy flash
        never fires after the button unmounts.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { CopyButton } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic usage</h2>
      <Example
        title="Basic usage"
        description="Pass the text to copy. With default labels it reads Copy and flips to Copied on click; the label, copied label, and icon size can each be overridden."
        render={() => <CopyButtonBasic />}
        code={copyButtonBasicSrc}
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
              <code>text</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>label</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"Copy"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>copiedLabel</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"Copied"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>ariaLabel</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"Copy"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>size</code>
            </td>
            <td>
              <code>number</code>
            </td>
            <td>
              <code>12</code>
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

      <PageFooter path="/components/copy-button" />
    </article>
  );
}
