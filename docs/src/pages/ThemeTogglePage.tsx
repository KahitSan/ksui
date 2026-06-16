import { type JSX } from "solid-js";
import ThemeToggleBasic from "../examples/theme-toggle-basic";
import themeToggleBasicSrc from "../examples/theme-toggle-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function ThemeTogglePage(): JSX.Element {
  return (
    <article>
      <h1>ThemeToggle</h1>
      <p class="lead">
        A controlled sliding sun/moon track switch. It owns no theme state and applies no theme — it renders the{" "}
        <code>value</code> you pass (<code>"dark"</code> or <code>"light"</code>) and reports the intended next value
        through <code>onToggle</code>. The parent keeps the source of truth, so the atom stays domain-free. In{" "}
        <code>"light"</code> the thumb slides right and the sun lights up; in <code>"dark"</code> the moon is active.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { ThemeToggle } from "@kahitsan/ksui";`} />
      </div>

      <h2>Both states (controlled)</h2>
      <Example
        title="Live and static"
        description="The first toggle is wired to a signal; the pair below shows the two fixed states."
        render={() => <ThemeToggleBasic />}
        code={themeToggleBasicSrc}
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
              <code>"dark" | "light"</code>
            </td>
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>onToggle</code>
            </td>
            <td>
              <code>{`(next: "dark" | "light") => void`}</code>
            </td>
            <td>n/a (required)</td>
          </tr>
          <tr>
            <td>
              <code>ariaLabel</code>
            </td>
            <td>
              <code>{`(next: "dark" | "light") => string`}</code>
            </td>
            <td>
              <code>{`(next) => \`Switch to \${next} mode\``}</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>testId</code>
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

      <PageFooter path="/components/theme-toggle" />
    </article>
  );
}
