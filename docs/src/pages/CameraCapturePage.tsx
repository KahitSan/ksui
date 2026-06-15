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
        Captures a photo from the device camera for uploads like a receipt or document photo. It opens a full screen
        modal, lets the user snap a photo and review or retake it, then hands the final photo back as a{" "}
        <code>File</code>.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { CameraCapture } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Open the capture modal"
        description="The modal opens on a granted camera with a live viewfinder and a capture button. When the camera cannot be accessed it falls back to a 'Could not access camera' message with a Close button instead of failing silently."
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
