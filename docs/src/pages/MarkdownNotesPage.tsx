import { type JSX } from "solid-js";
import MarkdownNotesBasic from "../examples/markdown-notes-basic";
import markdownNotesSrc from "../examples/markdown-notes-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function MarkdownNotesPage(): JSX.Element {
  return (
    <article>
      <h1>Markdown Notes</h1>
      <p class="lead">
        Renders a restricted markdown subset (bold, italic, inline code, links, lists) with inline client mention
        chips of the form <code>@[Name](client:N)</code>. The host owns routing, so mention chips link via a plain
        anchor.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { MarkdownNotes } from "@kahitsan/ksui";`} />
      </div>

      <h2>Basic</h2>
      <Example
        title="Markdown subset, mention chips"
        description="Bold, italic, inline code, a mention chip, and a bullet list."
        render={() => <MarkdownNotesBasic />}
        code={markdownNotesSrc}
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
              <code>value</code>
            </td>
            <td>
              <code>string | null | undefined</code>
            </td>
            <td>required</td>
          </tr>
          <tr>
            <td>
              <code>searchQuery</code>
            </td>
            <td>
              <code>string</code>
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
            <td>n/a</td>
          </tr>
        </tbody>
      </table>

      <h2>Accessibility</h2>
      <p>
        Mention chips render as anchors with the mentioned name as their text. The hover card fetches the sibling
        clients plugin and degrades to a non hovering chip when that is unavailable.
      </p>

      <PageFooter path="/components/markdown-notes" />
    </article>
  );
}
