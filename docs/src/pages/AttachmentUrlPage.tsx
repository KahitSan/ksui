import { type JSX } from "solid-js";
import AttachmentUrlBasic from "../examples/attachment-url-basic";
import src from "../examples/attachment-url-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function AttachmentUrlPage(): JSX.Element {
  return (
    <article>
      <h1>attachmentUrl / isResolvableAttachment</h1>
      <p class="lead">
        Two small safety helpers for attachment links. <code>attachmentUrl</code> returns the link only if it is an
        http(s) URL, else an empty string. <code>isResolvableAttachment</code> returns true or false for whether the
        link can actually be opened. They stop unsafe links from being used.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { attachmentUrl, isResolvableAttachment } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Truth table for a few links"
        description="Pure functions, fully live. Only the https row resolves; ftp, javascript and null all yield an empty url and a false resolvable flag."
        render={() => <AttachmentUrlBasic />}
        code={src}
      />

      <h2>Signatures</h2>
      <table class="props-table">
        <thead>
          <tr><th>Export</th><th>Type</th></tr>
        </thead>
        <tbody>
          <tr><td><code>attachmentUrl(s3Link)</code></td><td><code>(s3Link) =&gt; string</code></td></tr>
          <tr><td><code>isResolvableAttachment(s3Link)</code></td><td><code>(s3Link) =&gt; boolean</code></td></tr>
        </tbody>
      </table>

      <PageFooter path="/components/attachment-url" />
    </article>
  );
}
