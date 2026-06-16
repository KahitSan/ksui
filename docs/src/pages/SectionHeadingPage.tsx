import { type JSX } from "solid-js";
import SectionHeadingBasic from "../examples/section-heading-basic";
import sectionHeadingBasicSrc from "../examples/section-heading-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function SectionHeadingPage(): JSX.Element {
  return (
    <article>
      <h1>SectionHeading</h1>
      <p class="lead">
        A recurring section header block: an optional uppercase, wide-tracked <code>kicker</code> (the "eyebrow"), a{" "}
        <code>title</code>, an optional underline <code>accent</code> bar, and optional <code>subtitle</code> copy. It is
        presentational only and domain-free — every piece of text and color comes from props. The <code>title</code> and{" "}
        <code>subtitle</code> accept JSX, so a caller can apply its own brand styling (for example a gradient span on part
        of the title) without this component carrying any site-specific CSS.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { SectionHeading } from "@kahitsan/ksui";`} />
      </div>

      <h2>Alignment, kicker, accent, and subtitle</h2>
      <Example
        title="Alignment, kicker, accent, and subtitle"
        description="A left-aligned h1 with kicker and subtitle, a centered h2 with an underline accent, and a right-aligned block with a custom accent color."
        render={() => <SectionHeadingBasic />}
        code={sectionHeadingBasicSrc}
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
              <code>title</code>
            </td>
            <td>
              <code>JSX.Element</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>kicker</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>none</td>
          </tr>
          <tr>
            <td>
              <code>subtitle</code>
            </td>
            <td>
              <code>JSX.Element</code>
            </td>
            <td>none</td>
          </tr>
          <tr>
            <td>
              <code>accent</code>
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
              <code>accentClass</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"bg-amber-500"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>kickerClass</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"text-amber-500"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>titleClass</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"text-white"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>subtitleClass</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"text-zinc-400"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>align</code>
            </td>
            <td>
              <code>"left" | "center" | "right"</code>
            </td>
            <td>
              <code>"left"</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>as</code>
            </td>
            <td>
              <code>"h1" | "h2" | "h3"</code>
            </td>
            <td>
              <code>"h2"</code>
            </td>
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

      <PageFooter path="/components/section-heading" />
    </article>
  );
}
