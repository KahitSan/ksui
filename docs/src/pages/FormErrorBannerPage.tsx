import { type JSX } from "solid-js";
import FormErrorBannerBasic from "../examples/form-error-banner-basic";
import formErrorBannerBasicSrc from "../examples/form-error-banner-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function FormErrorBannerPage(): JSX.Element {
  return (
    <article>
      <h1>FormErrorBanner</h1>
      <p class="lead">
        The small red alert box that nearly every create and edit modal hand-rolls. Pass it a{" "}
        <code>message</code> and it shows a <code>role="alert"</code> banner. It is self-guarding: when the message is
        falsy (null, undefined, or an empty string) it renders nothing, so you do not need to wrap it in your own{" "}
        <code>Show</code>.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { FormErrorBanner } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic usage</h2>
      <Example
        title="Basic usage"
        description="A couple of form messages, plus a falsy message that renders nothing. The banner ships no margin of its own, so use the class prop for spacing."
        render={() => <FormErrorBannerBasic />}
        code={formErrorBannerBasicSrc}
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
              <code>message</code>
            </td>
            <td>
              <code>string | null | undefined</code>
            </td>
            <td>n/a</td>
          </tr>
          <tr>
            <td>
              <code>class</code>
            </td>
            <td>
              <code>string</code>
            </td>
            <td>
              <code>""</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Notes</h2>
      <p>
        The banner has no margin built in. Use the <code>class</code> prop for spacing such as <code>mt-3</code> or{" "}
        <code>mb-3</code> so it sits right inside your form. Because it hides itself on a falsy message, you can bind it
        straight to your error signal without an extra guard.
      </p>

      <PageFooter path="/components/form-error-banner" />
    </article>
  );
}
