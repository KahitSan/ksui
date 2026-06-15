import { type JSX } from "solid-js";
import ImageCropperBasic from "../examples/image-cropper-basic";
import src from "../examples/image-cropper-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function ImageCropperPage(): JSX.Element {
  return (
    <article>
      <h1>ImageCropper</h1>
      <p class="lead">
        Lets a user crop an uploaded image to a square (1:1) selection before you save it, so logos and avatars come
        out at a consistent size. You hand it an image <code>File</code> and it opens inside a host Modal; the user
        drags inside the box to reposition the selection and drags a corner to resize it. On Apply, the chosen region is
        drawn to a canvas at your requested output size and handed back as a WebP <code>Blob</code>, ready to upload.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { ImageCropper } from "@kahitsan/ksui";`} />
      </div>

      <h2>Pick and crop</h2>
      <Example
        title="Pick and crop a logo"
        description="Drag inside the box to move the selection, drag a corner to resize it, then Apply to get back the cropped 1:1 WebP."
        render={() => <ImageCropperBasic />}
        code={src}
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
              <code>file</code>
            </td>
            <td>
              <code>File</code>
            </td>
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>outputSize</code>
            </td>
            <td>
              <code>number</code>
            </td>
            <td>
              <code>512</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>onCancel</code>
            </td>
            <td>
              <code>() =&gt; void</code>
            </td>
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>onApply</code>
            </td>
            <td>
              <code>(blob: Blob) =&gt; void</code>
            </td>
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>busy</code>
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
              <code>title</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"Crop logo"</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Notes</h2>
      <p>
        The output is always a square WebP at <code>outputSize</code> by <code>outputSize</code> pixels, encoded at 0.9
        quality. Set <code>busy</code> while you upload the blob so the Cancel and Apply buttons disable and Apply reads{" "}
        <code>Saving…</code>. The Modal and Button it uses come from the host kit, so colors follow the host brand theme.
      </p>

      <PageFooter path="/components/image-cropper" />
    </article>
  );
}
