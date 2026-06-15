import { type JSX } from "solid-js";
import KpiCardBasic from "../examples/kpi-card-basic";
import kpiCardBasicSrc from "../examples/kpi-card-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function KpiCardPage(): JSX.Element {
  return (
    <article>
      <h1>KpiCard</h1>
      <p class="lead">
        A compact dashboard tile: a short uppercase caption, a big tone-colored value, an optional hint line, and an
        optional inline sparkline. It is presentational only. It never fetches data and never formats numbers, so the
        caller hands it a ready-to-show <code>value</code> string and picks a <code>tone</code>. The tone vocabulary
        (success, danger, info, warning) is shared with StatusPill so colors stay consistent across the app.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { KpiCard } from "@kahitsan/ksui";`} />
      </div>

      <h2>Tones, hints, and sparklines</h2>
      <Example
        title="Tones, hints, and sparklines"
        description="Four tiles with the four tones. Each passes a pre-formatted value, an icon, and a hint; three also pass a numeric series that draws the inline sparkline."
        render={() => <KpiCardBasic />}
        code={kpiCardBasicSrc}
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
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>value</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>tone</code>
            </td>
            <td>
              <code>"success" | "danger" | "info" | "warning"</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>icon</code>
            </td>
            <td>
              <code>(props: {`{ size?: number; class?: string }`}) =&gt; JSX.Element</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>hint</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>none</td>
          </tr>
          <tr>
            <td>
              <code>sparkline</code>
            </td>
            <td>
              <code>number[]</code>
            </td>
            <td>none (needs at least 2 points to draw)</td>
          </tr>
          <tr>
            <td>
              <code>clipClass</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>none</td>
          </tr>
          <tr>
            <td>
              <code>class</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>none</td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/kpi-card" />
    </article>
  );
}
