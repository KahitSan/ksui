import { type JSX } from "solid-js";
import ComboBoxBasic from "../examples/combo-box-basic";
import entityPickerSrc from "../examples/combo-box-basic.tsx?raw";
import ComboBoxMulti from "../examples/combo-box-multi";
import entityPickerMultiSrc from "../examples/combo-box-multi.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function ComboBoxPage(): JSX.Element {
  return (
    <article>
      <h1>Combo Box</h1>
      <p class="lead">
        A generic searchable-combobox engine for picking one record from a list: trigger button, portal popup with
        debounced search, viewport-aware positioning, an optional inline "create new" row, and graceful degradation when
        the backing source is unreachable. It is domain-free — you supply the data (<code>search</code> /{" "}
        <code>onCreate</code>) and the display (<code>idOf</code> / <code>labelOf</code> / <code>secondaryOf</code> /{" "}
        <code>icon</code> / <code>noun</code>). It is the single picker the library ships — build a payee, client,
        or any other picker by wiring its endpoint at the call site. It does single-select (a button trigger) or
        multi-select (an inline chips + input row) from the same engine.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { ComboBox } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Controlled selection with create"
        description="Provide search and onCreate as async functions (here backed by an in-memory list). Typing filters; when there's no exact match, a 'New person …' row appears. Selection is controlled via selected / onChange."
        render={() => <ComboBoxBasic />}
        code={entityPickerSrc}
      />

      <h2>Multiple selection</h2>
      <p>
        Pass <code>multiple</code> and a <code>value</code> array to switch to an inline chips + input row. Picking a
        result adds a chip and the popup stays open so you can add several; Backspace on an empty input removes the
        trailing chip. <code>primaryStar</code> marks <code>value[0]</code> as the primary (star) and lets other chips
        promote to it; <code>invalid</code> paints the required/empty tone; <code>lockedIds</code> anchors specific
        chips so they can't be removed or re-ordered.
      </p>
      <Example
        title="Multi-select with primary + create"
        description="multiple + value: T[] + onChange: (T[]) => void. primaryStar stars the first chip (click another to promote it); invalid paints the red empty tone. The same search / onCreate / idOf / labelOf wiring as single mode."
        render={() => <ComboBoxMulti />}
        code={entityPickerMultiSrc}
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
            <td><code>"combo-box"</code></td>
          </tr>
        </tbody>
      </table>

      <h2>Multiple-selection props</h2>
      <p>
        In <code>multiple</code> mode <code>selected</code> / <code>selectedName</code> / <code>defaultOpen</code> are
        replaced by the props below; the shared display props (<code>search</code>, <code>onCreate</code>,{" "}
        <code>idOf</code>, <code>labelOf</code>, <code>secondaryOf</code>, <code>icon</code>, <code>noun</code>,{" "}
        <code>placeholder</code>, <code>disabled</code>, <code>testIdPrefix</code>) are identical.
      </p>
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
            <td><code>multiple</code></td>
            <td><code>true</code></td>
            <td>required (selects multi mode)</td>
          </tr>
          <tr>
            <td><code>value</code></td>
            <td><code>T[]</code></td>
            <td>required (ordered; <code>value[0]</code> is primary)</td>
          </tr>
          <tr>
            <td><code>onChange</code></td>
            <td><code>(next: T[]) =&gt; void</code></td>
            <td>required</td>
          </tr>
          <tr>
            <td><code>primaryStar</code></td>
            <td><code>boolean</code></td>
            <td><code>false</code> (star value[0], click-to-promote)</td>
          </tr>
          <tr>
            <td><code>invalid</code></td>
            <td><code>boolean</code></td>
            <td><code>false</code> (red required/empty tone)</td>
          </tr>
          <tr>
            <td><code>lockedIds</code></td>
            <td><code>(string | number)[]</code></td>
            <td><code>undefined</code> (anchored chips)</td>
          </tr>
          <tr>
            <td><code>autoFocusOnMount</code></td>
            <td><code>boolean</code></td>
            <td><code>false</code></td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/combo-box" />
    </article>
  );
}
