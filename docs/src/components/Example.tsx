import { createSignal, Show, type JSX } from "solid-js";
import { CodeBlock } from "./CodeBlock";

interface ExampleProps {
  title?: string;
  description?: string;
  // The live rendered component.
  render: () => JSX.Element;
  // The verbatim source string (imported via ?raw) that produced `render`.
  // Because both come from one examples/*.tsx file, preview and code can never
  // drift.
  code: string;
  // Start with the code hidden behind a toggle (Park UI style). Default shows it.
  collapsible?: boolean;
}

export function Example(props: ExampleProps): JSX.Element {
  const [open, setOpen] = createSignal(!props.collapsible);
  return (
    <section class="example">
      <Show when={props.title}>
        <h3 class="example-title">{props.title}</h3>
      </Show>
      <Show when={props.description}>
        <p class="example-desc">{props.description}</p>
      </Show>
      <div class="bd-example">{props.render()}</div>
      <Show when={props.collapsible}>
        <button class="example-toggle" type="button" onClick={() => setOpen(!open())}>
          {open() ? "Hide code" : "Show code"}
        </button>
      </Show>
      <Show when={open()}>
        <CodeBlock code={props.code} stripBoilerplate />
      </Show>
    </section>
  );
}
