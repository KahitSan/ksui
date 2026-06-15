import { type JSX } from "solid-js";
import SegmentedFilterBasic from "../examples/segmented-filter-basic";
import segmentedFilterBasicSrc from "../examples/segmented-filter-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function SegmentedFilterPage(): JSX.Element {
  return (
    <article>
      <h1>SegmentedFilter</h1>
      <p class="lead">
        A rounded bordered row of segment buttons with one active at a time. It is presentational only and domain free:
        you pass the segment values and the active value, so no status names are baked in. A bare string option uses its
        value as the label and renders capitalized; an object option lets you give an explicit label that is not
        capitalized, which is handy for buckets and other non-status toggles.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { SegmentedFilter } from "@kahitsan/ksui";`} />
      </div>

      <h2>Status and bucket filters</h2>
      <Example
        title="Status and bucket filters"
        description="Top row uses bare strings (capitalized) for active, archived, all. Bottom row uses objects with explicit labels for time buckets. Click a segment to see the active value update."
        render={() => <SegmentedFilterBasic />}
        code={segmentedFilterBasicSrc}
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
              <code>options</code>
            </td>
            <td>
              <code>(string | {`{ value: string; label: string }`})[]</code>
            </td>
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>value</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>onChange</code>
            </td>
            <td>
              <code>(value: string) =&gt; void</code>
            </td>
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>testIdPrefix</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>undefined</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>class</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>undefined</code>
            </td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/segmented-filter" />
    </article>
  );
}
