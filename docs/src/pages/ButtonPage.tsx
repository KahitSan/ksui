import { type JSX } from "solid-js";
import ButtonBasic from "../examples/button-basic";
import buttonBasicSrc from "../examples/button-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function ButtonPage(): JSX.Element {
  return (
    <article>
      <h1>Button</h1>
      <p class="lead">
        The host owned button primitive for every clickable action in a plugin. Color comes from <code>intent</code>{" "}
        (primary, danger, secondary) and shape comes from <code>variant</code> (clip1, clip2, ghost, link), so the same
        component covers a main call to action, a destructive action, and an inline link. Hover runs a scanline shimmer,
        the clip variants carve HUD corners, and a click drops a ripple.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { Button } from "@kserp/host-ui";`} />
      </div>

      <h2>Intents and variants</h2>
      <Example
        title="Intents and variants"
        description="The primary, danger, and secondary intents across the clip1, clip2, ghost, and link variants, plus a disabled button. Hover shows the shimmer and a click drops the ripple."
        render={() => <ButtonBasic />}
        code={buttonBasicSrc}
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
              <code>intent</code>
            </td>
            <td>
              <code>"primary" | "danger" | "secondary"</code>
            </td>
            <td>
              <code>"primary"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>variant</code>
            </td>
            <td>
              <code>"clip1" | "clip2" | "ghost" | "link"</code>
            </td>
            <td>
              <code>"clip1"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>noRipple</code> / <code>noScanline</code> / <code>noGlow</code> / <code>noPulse</code>
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
              <code>icon</code> / <code>iconPosition</code>
            </td>
            <td>
              <code>Component / "left" | "right"</code>
            </td>
            <td>
              <code>"left"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>disabled</code>
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
              <code>onClick</code>
            </td>
            <td>
              <code>(e: MouseEvent) =&gt; void</code>
            </td>
            <td>n/a</td>
          </tr>
        </tbody>
      </table>

      <h2>Theming</h2>
      <p>
        Button colors come from the host brand theme at runtime. The variants map to brand tokens in the host shell;
        plugins do not restyle the button locally.
      </p>

      <PageFooter path="/components/button" />
    </article>
  );
}
