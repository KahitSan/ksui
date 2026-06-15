import { type JSX } from "solid-js";
import ProgressBarBasic from "../examples/progress-bar-basic";
import progressBarBasicSrc from "../examples/progress-bar-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function ProgressBarPage(): JSX.Element {
  return (
    <article>
      <h1>ProgressBar</h1>
      <p class="lead">
        A horizontal progress bar with a tinted fill, a pulsing edge indicator, and an optional
        shimmer. It can show an icon, a status label, and a free text label on the left, plus the
        percentage (or any custom right label) on the right. When <code>progress</code> goes past
        100 it draws an overflow band so you can show "over the limit" too. The color is read from a
        color name inside the <code>class</code> prop: <code>green</code>, <code>blue</code>,{" "}
        <code>amber</code>, <code>red</code>, <code>orange</code>, <code>purple</code>,{" "}
        <code>slate</code>, <code>gray</code>, or <code>zinc</code>.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { ProgressBar } from "@kahitsan/ksui";`} />
      </div>

      <h2>Examples</h2>
      <Example
        title="Progress states"
        description="Colors set through the class prop, a status label and icon, a custom right label, an overflow band past 100, and a hidden percentage."
        render={() => <ProgressBarBasic />}
        code={progressBarBasicSrc}
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
              <code>progress</code>
            </td>
            <td>
              <code>number</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>icon</code>
            </td>
            <td>
              <code>Component&lt;{`{ size: number; class?: string }`}&gt;</code>
            </td>
            <td>none</td>
          </tr>
          <tr>
            <td>
              <code>label</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>none</td>
          </tr>
          <tr>
            <td>
              <code>statusLabel</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>none</td>
          </tr>
          <tr>
            <td>
              <code>shimmer</code>
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
              <code>position</code>
            </td>
            <td>
              <code>"left" | "right"</code>
            </td>
            <td>
              <code>"left"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>hidePercentage</code>
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
              <code>rightLabel</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>none (replaces the percentage when set)</td>
          </tr>
          <tr>
            <td>
              <code>class</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>none (also carries the color name and any width)</td>
          </tr>
        </tbody>
      </table>

      <h2>Color and styling</h2>
      <p>
        ProgressBar does not take a separate color prop. Instead it scans the <code>class</code>{" "}
        string for a known color name and tints the fill, the edge indicator, and the shimmer to
        match. The same scan reads a text size class (like <code>text-sm</code>) to size the icon. If
        you do not include a <code>w-</code> width class, the bar fills its container width.
      </p>

      <PageFooter path="/components/progress-bar" />
    </article>
  );
}
