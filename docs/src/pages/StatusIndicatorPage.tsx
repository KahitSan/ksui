import { type JSX } from "solid-js";
import StatusIndicatorBasic from "../examples/status-indicator-basic";
import statusIndicatorBasicSrc from "../examples/status-indicator-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function StatusIndicatorPage(): JSX.Element {
  return (
    <article>
      <h1>StatusIndicator</h1>
      <p class="lead">
        A live-availability indicator: a filled, optionally pulsing colored dot beside a label. Color comes from{" "}
        <code>tone</code> (one of five domain-free tones) or the convenience <code>online</code> boolean. The caller maps
        its own state (open/closed, online/offline, healthy/degraded) to a tone and a plain label. Distinct from{" "}
        <code>StatusPill</code> (a bordered tinted text chip); this is the animated availability dot. Add a glowing
        animation with <code>pulse</code>, an uppercase marquee label with <code>uppercase</code>, or a small heading
        line with <code>caption</code>.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { StatusIndicator } from "@kahitsan/ksui";`} />
      </div>

      <h2>Tones, pulse, online, and caption</h2>
      <Example
        title="Tones, pulse, online, and caption"
        description="The five tones are success, neutral, warning, danger, and info. The online boolean maps to success/danger, pulse animates the dot with a glow, uppercase renders the marquee chip style, and caption adds a small heading line above the label."
        render={() => <StatusIndicatorBasic />}
        code={statusIndicatorBasicSrc}
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
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>tone</code>
            </td>
            <td>
              <code>"success" | "neutral" | "warning" | "danger" | "info"</code>
            </td>
            <td>
              <code>"neutral"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>online</code>
            </td>
            <td>
              <code>boolean</code>
            </td>
            <td>n/a (overrides tone when set)</td>
          </tr>
          <tr>
            <td>
              <code>pulse</code>
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
              <code>uppercase</code>
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
              <code>caption</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>n/a</td>
          </tr>
          <tr>
            <td>
              <code>captionClass</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"text-amber-400"</code>
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
          <tr>
            <td>
              <code>testId</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>n/a</td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/status-indicator" />
    </article>
  );
}
