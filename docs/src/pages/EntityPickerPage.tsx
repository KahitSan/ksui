import { type JSX } from "solid-js";
import EntityPickerBasic from "../examples/entity-picker-basic";
import entityPickerSrc from "../examples/entity-picker-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function EntityPickerPage(): JSX.Element {
  return (
    <article>
      <h1>Entity Picker</h1>
      <p class="lead">
        A generic searchable-combobox engine for picking one record from a list: trigger button, portal popup with
        debounced search, viewport-aware positioning, an optional inline "create new" row, and graceful degradation when
        the backing source is unreachable. It is domain-free — you supply the data (<code>search</code> /{" "}
        <code>onCreate</code>) and the display (<code>idOf</code> / <code>labelOf</code> / <code>secondaryOf</code> /{" "}
        <code>icon</code> / <code>noun</code>). <code>ClientPicker</code> and <code>PayeePicker</code> are thin presets
        over it.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { EntityPicker } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Controlled selection with create"
        description="Provide search and onCreate as async functions (here backed by an in-memory list). Typing filters; when there's no exact match, a 'New person …' row appears. Selection is controlled via selected / onChange."
        render={() => <EntityPickerBasic />}
        code={entityPickerSrc}
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
            <td><code>selected</code></td>
            <td><code>T | null</code></td>
            <td>required</td>
          </tr>
          <tr>
            <td><code>onChange</code></td>
            <td><code>(next: T | null) =&gt; void</code></td>
            <td>required</td>
          </tr>
          <tr>
            <td><code>search</code></td>
            <td><code>(query: string) =&gt; Promise&lt;T[]&gt;</code></td>
            <td>required</td>
          </tr>
          <tr>
            <td><code>idOf</code></td>
            <td><code>(item: T) =&gt; string | number</code></td>
            <td>required</td>
          </tr>
          <tr>
            <td><code>labelOf</code></td>
            <td><code>(item: T) =&gt; string</code></td>
            <td>required</td>
          </tr>
          <tr>
            <td><code>icon</code></td>
            <td><code>Component&lt;{`{ size?, class? }`}&gt;</code></td>
            <td>required</td>
          </tr>
          <tr>
            <td><code>noun</code></td>
            <td><code>string</code></td>
            <td>required (UI copy: "payee", "client")</td>
          </tr>
          <tr>
            <td><code>onCreate</code></td>
            <td><code>(name: string) =&gt; Promise&lt;T&gt;</code></td>
            <td><code>undefined</code> (no create row)</td>
          </tr>
          <tr>
            <td><code>secondaryOf</code></td>
            <td><code>(item: T) =&gt; string | null</code></td>
            <td><code>undefined</code> (no secondary line)</td>
          </tr>
          <tr>
            <td><code>selectedName</code></td>
            <td><code>string | null</code></td>
            <td><code>undefined</code> (free-text trigger fallback)</td>
          </tr>
          <tr>
            <td><code>placeholder</code></td>
            <td><code>string</code></td>
            <td><code>"Tap to pick a {`{noun}`}"</code></td>
          </tr>
          <tr>
            <td><code>disabled</code></td>
            <td><code>boolean</code></td>
            <td><code>false</code></td>
          </tr>
          <tr>
            <td><code>defaultOpen</code></td>
            <td><code>boolean</code></td>
            <td><code>false</code></td>
          </tr>
          <tr>
            <td><code>testIdPrefix</code></td>
            <td><code>string</code></td>
            <td><code>"entity-picker"</code></td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/entity-picker" />
    </article>
  );
}
