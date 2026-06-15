import { type JSX } from "solid-js";
import ExistingAttachmentTileBasic from "../examples/existing-attachment-tile-basic";
import src from "../examples/existing-attachment-tile-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function ExistingAttachmentTilePage(): JSX.Element {
  return (
    <article>
      <h1>Existing Attachment Tile</h1>
      <p class="lead">
        Shows one already uploaded file as a small tile. An image shows a preview; anything else shows a paperclip and
        filename tile that links to the file. A broken or unsafe link shows an Unavailable placeholder. An optional
        remove button asks for confirmation before deleting.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { ExistingAttachmentTile, type ExistingAttachment } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Image preview and an unavailable file"
        description="An https image link previews and shows a remove button when onDelete is passed, with the host's confirm helper guarding the delete. A null s3_link renders the Unavailable placeholder and has no remove button."
        render={() => <ExistingAttachmentTileBasic />}
        code={src}
      />

      <h2>Props</h2>
      <table class="props-table">
        <thead>
          <tr><th>Prop</th><th>Type</th><th>Default</th></tr>
        </thead>
        <tbody>
          <tr><td><code>attachment</code></td><td><code>ExistingAttachment</code></td><td>required</td></tr>
          <tr><td><code>testId</code></td><td><code>string</code></td><td>required</td></tr>
          <tr><td><code>onDelete</code></td><td><code>(id: number) =&gt; Promise&lt;void&gt; | void</code></td><td>n/a</td></tr>
          <tr><td><code>fallbackIcon</code></td><td><code>{"Component<{ size?: number }>"}</code></td><td>paperclip</td></tr>
        </tbody>
      </table>

      <PageFooter path="/components/existing-attachment-tile" />
    </article>
  );
}
