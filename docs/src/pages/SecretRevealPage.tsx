import { type JSX } from "solid-js";
import SecretRevealBasic from "../examples/secret-reveal-basic";
import secretRevealBasicSrc from "../examples/secret-reveal-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function SecretRevealPage(): JSX.Element {
  return (
    <article>
      <h1>SecretReveal</h1>
      <p class="lead">
        A "save this now" callout for a one-time secret such as a freshly created API key. It is an amber bordered box
        with a warning line, the secret shown in a monospace code block, a Copy button, and an optional footer caption.
        It holds no fetch and no plugin state, so the caller decides when to mount it. Usually you wrap it in a{" "}
        <code>&lt;Show when=&#123;revealed()&#125;&gt;</code> so it appears right after the secret comes back the one time
        the server returns it.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { SecretReveal } from "@kahitsan/ksui";`} />
      </div>

      <h2>Example</h2>
      <Example
        title="Reveal a one-time secret"
        description="The first box uses the default warning and a caption. The second uses a custom warning and no caption. Click Copy to copy the value."
        render={() => <SecretRevealBasic />}
        code={secretRevealBasicSrc}
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
              <code>secret</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>warning</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>"Save this now - it will not be shown again."</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>caption</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>none</td>
          </tr>
          <tr>
            <td>
              <code>testId</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>none</td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/secret-reveal" />
    </article>
  );
}
