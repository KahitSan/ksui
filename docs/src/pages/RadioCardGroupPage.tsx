import { type JSX } from "solid-js";
import RadioCardGroupBasic from "../examples/radio-card-group-basic";
import radioCardGroupBasicSrc from "../examples/radio-card-group-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function RadioCardGroupPage(): JSX.Element {
  return (
    <article>
      <h1>RadioCardGroup</h1>
      <p class="lead">
        A controlled, keyboard-navigable group of radio cards. You hand it the options, the selected key, and an{" "}
        <code>onChange</code> callback. It handles the roving-tabindex keyboard model for you: arrow keys move and select
        with wrap-around, Home and End jump to the ends, and exactly one card is a tab stop at a time.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { RadioCardGroup } from "@kahitsan/ksui";`} />
      </div>

      <h2>Example</h2>
      <Example
        title="Plan picker"
        description="Three plan options with a custom renderOption that shows a name and price line. The selection is controlled by a signal. Use the arrow keys, Home, and End to move between cards."
        render={() => <RadioCardGroupBasic />}
        code={radioCardGroupBasicSrc}
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
              <code>options</code>
            </td>
            <td>
              <code>T[]</code>
            </td>
            <td>n/a</td>
          </tr>
          <tr>
            <td>
              <code>value</code>
            </td>
            <td>
              <code>string | null</code>
            </td>
            <td>n/a</td>
          </tr>
          <tr>
            <td>
              <code>onChange</code>
            </td>
            <td>
              <code>(value: string) =&gt; void</code>
            </td>
            <td>n/a</td>
          </tr>
          <tr>
            <td>
              <code>keyOf</code>
            </td>
            <td>
              <code>(option: T) =&gt; string</code>
            </td>
            <td>n/a</td>
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
          <tr>
            <td>
              <code>renderOption</code>
            </td>
            <td>
              <code>(option: T, selected: boolean) =&gt; JSX.Element</code>
            </td>
            <td>dot + label</td>
          </tr>
          <tr>
            <td>
              <code>labelOf</code>
            </td>
            <td>
              <code>(option: T) =&gt; string</code>
            </td>
            <td>
              <code>String(keyOf(option))</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>columns</code>
            </td>
            <td>
              <code>number | "auto"</code>
            </td>
            <td>
              <code>"auto"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>class</code> / <code>itemClass</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>n/a</td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/radio-card-group" />
    </article>
  );
}
