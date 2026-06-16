import { type JSX } from "solid-js";
import NotFoundBasic from "../examples/not-found-basic";
import notFoundBasicSrc from "../examples/not-found-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function NotFoundPage(): JSX.Element {
  return (
    <article>
      <h1>NotFound</h1>
      <p class="lead">
        A centered 404 / empty-state panel: an optional <code>logo</code> slot, a large display{" "}
        <code>title</code>, a <code>heading</code>, a <code>message</code>, and a default action button. Every piece of
        copy defaults to a generic 404 string but is fully overridable, so nothing domain-specific lives in the
        primitive. The default action is a self-styled button driven by <code>onButtonClick</code> (or an anchor via{" "}
        <code>href</code>); pass <code>action</code> to drop in your own button (e.g. the host Button) entirely.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { NotFound } from "@kahitsan/ksui";`} />
      </div>

      <h2>Variants</h2>
      <Example
        title="Default, custom copy, anchor, and no-button"
        description="The default renders a 404 with a Go Back Home button. Override title/heading/message/buttonText for any empty state, pass a logo slot, use href to render an anchor, or hideButton to drop the action."
        render={() => <NotFoundBasic />}
        code={notFoundBasicSrc}
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
            <td><code>title</code></td>
            <td><code>string</code></td>
            <td><code>"404"</code> (pass <code>""</code> to hide)</td>
          </tr>
          <tr>
            <td><code>heading</code></td>
            <td><code>string</code></td>
            <td><code>"Page Not Found"</code></td>
          </tr>
          <tr>
            <td><code>message</code></td>
            <td><code>string</code></td>
            <td><code>"The page you're looking for…"</code></td>
          </tr>
          <tr>
            <td><code>buttonText</code></td>
            <td><code>string</code></td>
            <td><code>"Go Back Home"</code></td>
          </tr>
          <tr>
            <td><code>href</code></td>
            <td><code>string</code></td>
            <td>n/a (renders an anchor when set)</td>
          </tr>
          <tr>
            <td><code>onButtonClick</code></td>
            <td><code>{"() => void"}</code></td>
            <td>n/a</td>
          </tr>
          <tr>
            <td><code>logo</code></td>
            <td><code>JSX.Element</code></td>
            <td>n/a</td>
          </tr>
          <tr>
            <td><code>hideButton</code></td>
            <td><code>boolean</code></td>
            <td><code>false</code></td>
          </tr>
          <tr>
            <td><code>action</code></td>
            <td><code>JSX.Element</code></td>
            <td>n/a (replaces the built-in button)</td>
          </tr>
          <tr>
            <td><code>class</code></td>
            <td><code>string</code></td>
            <td>n/a</td>
          </tr>
          <tr>
            <td><code>testId</code></td>
            <td><code>string</code></td>
            <td>n/a</td>
          </tr>
        </tbody>
      </table>

      <PageFooter path="/components/not-found" />
    </article>
  );
}
