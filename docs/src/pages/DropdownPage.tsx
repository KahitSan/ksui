import { type JSX } from "solid-js";
import DropdownBasic from "../examples/dropdown-basic";
import dropdownBasicSrc from "../examples/dropdown-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function DropdownPage(): JSX.Element {
  return (
    <article>
      <h1>Dropdown</h1>
      <p class="lead">
        A generic single-select dropdown: a labeled trigger that opens a panel of items. Each item carries a{" "}
        <code>label</code> and optional <code>description</code>, <code>icon</code>, <code>badge</code>, a leading
        status dot (<code>status</code>), and a <code>disabled</code> flag. Clicking outside closes the panel and the
        chevron rotates while open. Presentational and domain-free — the caller maps its own enum onto the three{" "}
        <code>status</code> states and supplies all copy.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { Dropdown, type DropdownItem } from "@kahitsan/ksui";`} />
      </div>

      <h2>Items, icons, status dots, and badges</h2>
      <Example
        title="Items, icons, status dots, and badges"
        description="Items may carry an icon (which takes precedence over the status dot), a description line, a badge pill, and a disabled state. The second control shows the disabled trigger."
        render={() => <DropdownBasic />}
        code={dropdownBasicSrc}
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
              <code>items</code>
            </td>
            <td>
              <code>DropdownItem[]</code>
            </td>
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>value</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>items[0].id</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>placeholder</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"Select an option"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>icon</code>
            </td>
            <td>
              <code>IconComponent</code>
            </td>
            <td>n/a</td>
          </tr>
          <tr>
            <td>
              <code>minWidth</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"280px"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>disabled</code>
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
              <code>onSelect</code>
            </td>
            <td>
              <code>(item: DropdownItem) =&gt; void</code>
            </td>
            <td>n/a</td>
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

      <PageFooter path="/components/dropdown" />
    </article>
  );
}
