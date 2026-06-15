import { type JSX } from "solid-js";
import AddAttachmentTileBasic from "../examples/add-attachment-tile-basic";
import src from "../examples/add-attachment-tile-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function AddAttachmentTilePage(): JSX.Element {
  return (
    <article>
      <h1>Add Attachment Tile</h1>
      <p class="lead">
        A dashed square Add tile. Tapping it opens a tiny menu with two choices: take a photo with the camera, or pick
        an image or file from the device. It shows an Uploading label while a file is being sent.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { AddAttachmentTile } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="The Add tile and its menu"
        description="Fully live. Click the tile to open its two choice menu; either choice flashes the Uploading state for a moment so you can see it. The tile uses the host's ks-hud-clip-top-left-bottom-right class for its angled corner, which is not loaded here, so the corner is square rather than clipped; everything else is faithful."
        render={() => <AddAttachmentTileBasic />}
        code={src}
      />

      <h2>Props</h2>
      <table class="props-table">
        <thead>
          <tr><th>Prop</th><th>Type</th><th>Default</th></tr>
        </thead>
        <tbody>
          <tr><td><code>uploading</code></td><td><code>boolean</code></td><td>required</td></tr>
          <tr><td><code>onPickFile</code></td><td><code>() =&gt; void</code></td><td>required</td></tr>
          <tr><td><code>onPickCamera</code></td><td><code>() =&gt; void</code></td><td>required</td></tr>
        </tbody>
      </table>

      <PageFooter path="/components/add-attachment-tile" />
    </article>
  );
}
