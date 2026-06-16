import { type JSX } from "solid-js";
import EyebrowBadgeBasic from "../examples/eyebrow-badge-basic";
import eyebrowBadgeBasicSrc from "../examples/eyebrow-badge-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function EyebrowBadgePage(): JSX.Element {
  return (
    <article>
      <h1>EyebrowBadge</h1>
      <p class="lead">
        A tiny uppercase, wide-tracked kicker label — the micro-heading that sits above a section title. The plain variant
        is just tracked text; the <code>bordered</code> variant wraps it in a tinted pill with a left accent border (the
        hero-style kicker). Color comes from <code>tone</code> and letter-spacing from <code>tracking</code>. Domain-free:
        the caller supplies the label.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { EyebrowBadge } from "@kahitsan/ksui";`} />
      </div>

      <h2>Variants, tones, and tracking</h2>
      <Example
        title="Variants, tones, and tracking"
        description="The bordered prop renders the tinted pill with a left accent border; without it the badge is plain tracked text. Pick a tone (amber, blue, emerald, red, zinc) and a tracking preset (normal, wide, wider)."
        render={() => <EyebrowBadgeBasic />}
        code={eyebrowBadgeBasicSrc}
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
              <code>"amber" | "blue" | "emerald" | "red" | "zinc"</code>
            </td>
            <td>
              <code>"amber"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>bordered</code>
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
              <code>tracking</code>
            </td>
            <td>
              <code>"normal" | "wide" | "wider"</code>
            </td>
            <td>
              <code>"normal"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>block</code>
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

      <PageFooter path="/components/eyebrow-badge" />
    </article>
  );
}
