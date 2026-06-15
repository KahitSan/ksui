import { type JSX } from "solid-js";
import CameraCaptureBasic from "../examples/camera-capture-basic";
import src from "../examples/camera-capture-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function CameraCapturePage(): JSX.Element {
  return (
    <article>
      <h1>Camera Capture</h1>
      <p class="lead">
        A full screen modal that opens the device camera, lets you snap a photo, review or retake it, and hands the
        final photo back as a <code>File</code>. Good for uploading a receipt or document photo.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { CameraCapture } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Open the capture modal"
        description="Click 'Open camera' to mount the modal live. In this docs page there is no granted camera, so it lands in its error state and shows the 'Could not access camera' message plus a Close button. That graceful failure is itself the thing being demonstrated. On a real device with permission granted it shows the live viewfinder and capture button."
        render={() => <CameraCaptureBasic />}
        code={src}
      />

      <h2>Props</h2>
      <table class="props-table">
        <thead>
          <tr><th>Prop</th><th>Type</th><th>Default</th></tr>
        </thead>
        <tbody>
          <tr><td><code>onCapture</code></td><td><code>(file: File) =&gt; void</code></td><td>required</td></tr>
          <tr><td><code>onClose</code></td><td><code>() =&gt; void</code></td><td>required</td></tr>
        </tbody>
      </table>

      <PageFooter path="/components/camera-capture" />
    </article>
  );
}
