import { type JSX } from "solid-js";
import SocialLinksBarBasic from "../examples/social-links-bar-basic";
import socialLinksBarBasicSrc from "../examples/social-links-bar-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function SocialLinksBarPage(): JSX.Element {
  return (
    <article>
      <h1>SocialLinksBar</h1>
      <p class="lead">
        A horizontal row of accessible icon buttons that link out to external profiles. Each button opens its{" "}
        <code>href</code> in a new tab with a safe <code>rel</code>, carries an <code>aria-label</code>, and renders a
        caller-supplied icon. Domain-free: the URLs, icons, and labels all come from the <code>links</code> prop, so
        nothing site-specific lives in the component. Choose the full-circle <code>round</code> shape (default) or the
        angular <code>clip</code> shape.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { SocialLinksBar } from "@kahitsan/ksui";`} />
      </div>

      <h2>Round and clip shapes</h2>
      <Example
        title="Round and clip shapes"
        description="The default round shape is a full circle; the clip shape cuts the top-right corner with a clip-path for the angular brand variant. Icons come from any component that accepts a numeric size (lucide-solid icons satisfy this)."
        render={() => <SocialLinksBarBasic />}
        code={socialLinksBarBasicSrc}
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
              <code>links</code>
            </td>
            <td>
              <code>SocialLink[]</code>
            </td>
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>shape</code>
            </td>
            <td>
              <code>"round" | "clip"</code>
            </td>
            <td>
              <code>"round"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>buttonSize</code>
            </td>
            <td>
              <code>number</code>
            </td>
            <td>
              <code>40</code> (<code>48</code> for clip)
            </td>
          </tr>
          <tr>
            <td>
              <code>iconSize</code>
            </td>
            <td>
              <code>number</code>
            </td>
            <td>~45% of buttonSize</td>
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

      <PageFooter path="/components/social-links-bar" />
    </article>
  );
}
