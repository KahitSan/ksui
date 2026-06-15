import { type JSX } from "solid-js";
import BuildLogoSrcBasic from "../examples/build-logo-src-basic";
import src from "../examples/build-logo-src-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function BuildLogoSrcPage(): JSX.Element {
  return (
    <article>
      <h1>buildLogoSrc</h1>
      <p class="lead">
        A tiny safety helper. You give it a stored logo link and it returns it only if it is an http or https URL,
        otherwise it returns an empty string. This blocks unsafe links like <code>javascript:</code> from ever reaching
        an image tag.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { buildLogoSrc } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Safe links pass, unsafe links become empty"
        description="Pure function, fully live. Each row feeds an input through buildLogoSrc and into an img src. Only the http(s) rows produce an image; the javascript: and relative rows return an empty string so the img shows nothing."
        render={() => <BuildLogoSrcBasic />}
        code={src}
      />

      <h2>Signature</h2>
      <table class="props-table">
        <thead>
          <tr><th>Arg</th><th>Type</th></tr>
        </thead>
        <tbody>
          <tr><td><code>s3Link</code></td><td><code>string | null | undefined</code></td></tr>
        </tbody>
      </table>

      <PageFooter path="/components/build-logo-src" />
    </article>
  );
}
