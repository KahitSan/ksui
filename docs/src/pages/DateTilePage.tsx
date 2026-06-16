import { type JSX } from "solid-js";
import DateTileBasic from "../examples/date-tile-basic";
import dateTileBasicSrc from "../examples/date-tile-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function DateTilePage(): JSX.Element {
  return (
    <article>
      <h1>DateTile</h1>
      <p class="lead">
        A compact calendar day cell: a small uppercase top band (e.g. a month label), a big primary value (e.g. the
        day-of-month), and an optional muted sub-label (e.g. hours, a count, a short note). Repeat it into a
        ledger-style row of days scanned like a register, not a full month grid. It is domain-free and presentational
        only — the caller formats every string and owns selection state.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { DateTile } from "@kahitsan/ksui";`} />
      </div>

      <h2>Interactive and static</h2>
      <Example
        title="Selectable and read-only"
        description="Pass onToggle to make the tile a selectable button (with aria-pressed). Omit it for a static, dimmed read-only cell. The value can be any short string, not just a number."
        render={() => <DateTileBasic />}
        code={dateTileBasicSrc}
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
              <code>value</code>
            </td>
            <td>
              <code>number | string</code>
            </td>
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>topLabel</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>""</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>subLabel</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>undefined</code> (hidden)
            </td>
          </tr>
          <tr>
            <td>
              <code>selected</code>
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
              <code>onToggle</code>
            </td>
            <td>
              <code>{`() => void`}</code>
            </td>
            <td>
              <code>undefined</code> (static cell)
            </td>
          </tr>
          <tr>
            <td>
              <code>testId</code>
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

      <PageFooter path="/components/date-tile" />
    </article>
  );
}
