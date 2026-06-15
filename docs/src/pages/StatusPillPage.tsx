import { type JSX } from "solid-js";
import StatusPillBasic from "../examples/status-pill-basic";
import statusPillBasicSrc from "../examples/status-pill-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function StatusPillPage(): JSX.Element {
  return (
    <article>
      <h1>StatusPill</h1>
      <p class="lead">
        A small status chip: an uppercase, wide-tracked label inside a tinted, bordered pill. Color comes from{" "}
        <code>tone</code> (one of five domain-free tones). The caller maps its own enum (a transaction status, an{" "}
        <code>is_active</code> flag, a voucher state) to a tone and a plain label, so nothing domain-specific leaks into
        the atom. Add a leading dot with <code>dot</code>, or a heavier background with <code>solid</code>.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { StatusPill } from "@kahitsan/ksui";`} />
      </div>

      <h2>Tones, dot, and solid</h2>
      <Example
        title="Tones, dot, and solid"
        description="The five tones are success, neutral, warning, danger, and info. The dot prop adds a leading dot, and the solid prop swaps the tinted background for a heavier filled one."
        render={() => <StatusPillBasic />}
        code={statusPillBasicSrc}
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
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>dot</code>
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
              <code>solid</code>
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

      <PageFooter path="/components/status-pill" />
    </article>
  );
}
