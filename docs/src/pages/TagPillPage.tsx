import { type JSX } from "solid-js";
import TagPillBasic from "../examples/tag-pill-basic";
import tagPillBasicSrc from "../examples/tag-pill-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function TagPillPage(): JSX.Element {
  return (
    <article>
      <h1>TagPill</h1>
      <p class="lead">
        A tiny, intentionally neutral rounded-full chip for category and tag lists. It is strictly zinc with no tone, no
        dot, and no uppercase, which keeps it visually distinct from <code>StatusPill</code>. When you need a colored
        chip, reach for <code>StatusPill</code> instead. TagPill is domain-free and presentational only.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { TagPill } from "@kahitsan/ksui";`} />
      </div>

      <h2>Tag lists</h2>
      <Example
        title="Tag lists"
        description="Neutral zinc chips for a tag or category list. The label is the only required prop."
        render={() => <TagPillBasic />}
        code={tagPillBasicSrc}
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
              <code>class</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>""</code>
            </td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/tag-pill" />
    </article>
  );
}
