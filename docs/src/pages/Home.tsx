import { type JSX } from "solid-js";
import { A } from "@solidjs/router";

export default function Home(): JSX.Element {
  return (
    <article>
      <h1 class="brand-title">
        KS<span class="brand-accent">UI</span>
      </h1>
      <p class="lead">
        A set of SolidJS UI components you can use in your own project or when contributing to KahitSan plugins.
        Published to the public npm registry and MIT licensed.
      </p>

      <h2>What you get</h2>
      <ul class="feature-list">
        <li>Reusable pickers: client, voucher, and payment account selectors with built in search.</li>
        <li>Rich content widgets: a mention aware textarea and a restricted markdown notes renderer.</li>
        <li>The attachment trio: camera capture, add attachment tile, and existing attachment tile.</li>
        <li>The data driven account avatar plus its icon, color, and logo URL helpers.</li>
        <li>The canonical <code>@kserp/host-ui</code> ambient type contract, shipped alongside the source.</li>
        <li>Source shipped under a <code>solid</code> export condition so the consumer compiles it with one shared solid-js runtime.</li>
      </ul>

      <h2>Live docs</h2>
      <p>
        Every component is the real source from <code>../src</code>, compiled by vite-plugin-solid. Each example shows the
        rendered result on top and its exact source directly below.
      </p>
      <p>
        Start with <A href="/getting-started">Getting Started</A>, or jump to a component:{" "}
        <A href="/components/button">Button</A>, <A href="/components/modal">Modal</A>,{" "}
        <A href="/components/entity-picker">Entity Picker</A>,{" "}
        <A href="/components/markdown-notes">Markdown Notes</A>.
      </p>
    </article>
  );
}
