import { type JSX } from "solid-js";
import MentionTextareaBasic from "../examples/mention-textarea-basic";
import src from "../examples/mention-textarea-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function MentionTextareaPage(): JSX.Element {
  return (
    <article>
      <h1>Mention Textarea</h1>
      <p class="lead">
        A notes box where typing <code>@</code> opens a dropdown of clients to tag. A picked client shows as a colored
        chip inline, and the value you read and write back is a token string like <code>@[Name](client:5)</code>.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { MentionTextarea } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Controlled notes with @ mentions"
        description="Type freely and the box returns the raw token value. The @ dropdown fetches the clients plugin to list people to tag; when that endpoint is unreachable the popup shows 'no results' and the box still works as a plain notes editor."
        render={() => <MentionTextareaBasic />}
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
          <tr><td><code>value</code></td><td><code>string</code></td><td>required</td></tr>
          <tr><td><code>setValue</code></td><td><code>(next: string) =&gt; void</code></td><td>required</td></tr>
          <tr><td><code>placeholder</code></td><td><code>string</code></td><td>n/a</td></tr>
          <tr><td><code>rows</code></td><td><code>number</code></td><td><code>2</code></td></tr>
          <tr><td><code>class</code></td><td><code>string</code></td><td>n/a</td></tr>
          <tr><td><code>ariaLabel</code></td><td><code>string</code></td><td>n/a</td></tr>
          <tr><td><code>disabled</code></td><td><code>boolean</code></td><td><code>false</code></td></tr>
          <tr><td><code>onBlur</code></td><td><code>() =&gt; void</code></td><td>n/a</td></tr>
        </tbody>
      </table>

      <PageFooter path="/components/mention-textarea" />
    </article>
  );
}
