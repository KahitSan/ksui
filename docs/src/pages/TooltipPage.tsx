import { type JSX } from "solid-js";
import TooltipBasic from "../examples/tooltip-basic";
import tooltipBasicSrc from "../examples/tooltip-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function TooltipPage(): JSX.Element {
  return (
    <article>
      <h1>Tooltip</h1>
      <p class="lead">
        A lightweight hover and focus tooltip. It is CSS-only, so there is no JS positioning and no portal. Wrap any
        trigger element and pass the bubble text through <code>content</code>. Use it for short copy on buttons and chips
        that needs to read more clearly than the native <code>title</code> attribute.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { Tooltip } from "@kahitsan/ksui";`} />
      </div>

      <h2>Placement and triggers</h2>
      <Example
        title="Placement and triggers"
        description="Hover or keyboard-focus a trigger to reveal its bubble. Placement defaults to top; pass placement='bottom' to flip it. The trigger can be a button or any inline element."
        render={() => <TooltipBasic />}
        code={tooltipBasicSrc}
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
              <code>content</code>
            </td>
            <td>
              <code>JSX.Element</code>
            </td>
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>children</code>
            </td>
            <td>
              <code>JSX.Element</code>
            </td>
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>placement</code>
            </td>
            <td>
              <code>"top" | "bottom"</code>
            </td>
            <td>
              <code>"top"</code>
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
              <code>id</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              auto via <code>createUniqueId()</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Accessibility</h2>
      <p>
        The bubble carries <code>role="tooltip"</code> with a stable id, and the wrapper carries{" "}
        <code>aria-describedby</code> pointing at it, so assistive tech can find the description. When your real focusable
        trigger sits deeper than the wrapper span, pass an explicit <code>id</code> and forward it as{" "}
        <code>aria-describedby</code> on that trigger, which is what the W3C tooltip pattern prefers.
      </p>

      <PageFooter path="/components/tooltip" />
    </article>
  );
}
