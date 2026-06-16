import { type JSX } from "solid-js";
import ButtonHudBasic from "../examples/button-hud-basic";
import buttonHudBasicSrc from "../examples/button-hud-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function ButtonHudPage(): JSX.Element {
  return (
    <article>
      <h1>Button</h1>
      <p class="lead">
        A domain-free HUD button. <code>intent</code> picks the color tone (<code>primary</code>, <code>danger</code>,{" "}
        <code>secondary</code>) and <code>variant</code> picks the shape and effect treatment (<code>clip1</code>,{" "}
        <code>clip2</code>, <code>ghost</code>, <code>link</code>). It ships scanline, clip-corner, ripple, glow, and
        pulse effects with zero kahitsan-specific copy or imports — pass plain children and an optional{" "}
        <code>icon</code>. The effect CSS is injected once at runtime, so the published package needs no sidecar
        stylesheet.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { Button } from "@kahitsan/ksui";`} />
      </div>

      <h2>Intents, variants, and icons</h2>
      <Example
        title="Intents, variants, and icons"
        description="Three intents (primary, danger, secondary) across four variants (clip1, clip2, ghost, link), plus left/right icons, icon-only, and the disabled state. Effects render on a dark surface where the HUD treatment reads best."
        render={() => <ButtonHudBasic />}
        code={buttonHudBasicSrc}
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
            <td><code>intent</code></td>
            <td><code>"primary" | "danger" | "secondary"</code></td>
            <td><code>"primary"</code></td>
          </tr>
          <tr>
            <td><code>variant</code></td>
            <td><code>"clip1" | "clip2" | "ghost" | "link"</code></td>
            <td><code>"clip1"</code></td>
          </tr>
          <tr>
            <td><code>as</code></td>
            <td><code>string | Component</code></td>
            <td><code>"button"</code></td>
          </tr>
          <tr>
            <td><code>icon</code></td>
            <td><code>{`(props: { size?: number; class?: string }) => JSX.Element`}</code></td>
            <td>n/a</td>
          </tr>
          <tr>
            <td><code>iconPosition</code></td>
            <td><code>"left" | "right"</code></td>
            <td><code>"left"</code></td>
          </tr>
          <tr>
            <td><code>noRipple</code></td>
            <td><code>boolean</code></td>
            <td><code>false</code></td>
          </tr>
          <tr>
            <td><code>noScanline</code></td>
            <td><code>boolean</code></td>
            <td><code>false</code></td>
          </tr>
          <tr>
            <td><code>noGlow</code></td>
            <td><code>boolean</code></td>
            <td><code>false</code></td>
          </tr>
          <tr>
            <td><code>noPulse</code></td>
            <td><code>boolean</code></td>
            <td><code>false</code></td>
          </tr>
          <tr>
            <td><code>disabled</code></td>
            <td><code>boolean</code></td>
            <td><code>false</code></td>
          </tr>
          <tr>
            <td><code>onClick</code></td>
            <td><code>(event: MouseEvent) =&gt; void</code></td>
            <td>n/a</td>
          </tr>
          <tr>
            <td><code>class</code></td>
            <td><code>string</code></td>
            <td>n/a</td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/button" />
    </article>
  );
}
