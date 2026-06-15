import { type JSX } from "solid-js";
import ChartLegendBasic from "../examples/chart-legend-basic";
import chartLegendBasicSrc from "../examples/chart-legend-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function ChartLegendPage(): JSX.Element {
  return (
    <article>
      <h1>ChartLegend</h1>
      <p class="lead">
        One entry in a chart legend. It shows a small colored dot, an uppercase label, and a pre-formatted value under
        the label. Cashflow and analytics charts use it to name each series (money in, money out, net) and show its
        current total. It is purely presentational: the caller supplies the dot color, the label, the value string, and
        an optional value color.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { ChartLegend } from "@kahitsan/ksui";`} />
      </div>

      <h2>Example</h2>
      <Example
        title="Cashflow legend"
        description="Three legend entries with different dot colors and value colors. The value text is already formatted by the caller."
        render={() => <ChartLegendBasic />}
        code={chartLegendBasicSrc}
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
              <code>dot</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>n/a</td>
          </tr>
          <tr>
            <td>
              <code>label</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>n/a</td>
          </tr>
          <tr>
            <td>
              <code>value</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>n/a</td>
          </tr>
          <tr>
            <td>
              <code>valueColor</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"text-zinc-100"</code>
            </td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/chart-legend" />
    </article>
  );
}
