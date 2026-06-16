import { type JSX } from "solid-js";
import { A } from "@solidjs/router";
import { CodeBlock } from "../components/CodeBlock";
import { PackageManagerTabs } from "../components/PackageManagerTabs";
import { PageFooter } from "../components/PageFooter";

export default function GettingStarted(): JSX.Element {
  return (
    <article>
      <h1>Getting Started</h1>
      <p class="lead">
        KSUI is an open source SolidJS UI kit (MIT licensed). Install it in your own SolidJS project, or use it to
        build KahitSan plugins. Import the widget you need by its bare specifier and drop it in.
      </p>

      <h2>Introduction</h2>
      <p>
        KSUI is a set of ready to use SolidJS components, published to the public npm registry. It gives you:
      </p>
      <ul class="feature-list">
        <li>Search aware pickers (client, voucher, payment account).</li>
        <li>A mention textarea and a restricted markdown notes renderer.</li>
        <li>The camera capture, add attachment, and existing attachment tiles.</li>
        <li>A data driven account avatar plus its icon / color / logo helpers.</li>
        <li>Its own self-styled primitives (Button, Modal, <code>confirm</code>, string match helpers) — no host kit needed.</li>
      </ul>

      <h2>Installation</h2>
      <p>The package is on the public npm registry, so no extra registry setup or login is needed.</p>
      <PackageManagerTabs pkg="@kahitsan/ksui" />
      <p style={{ "margin-top": "0.75rem" }}>
        It declares <code>solid-js</code> as a peer dependency, so it shares the consumer's single Solid runtime.
      </p>

      <h2>Quick start</h2>
      <p>Import a component by its bare specifier and drop it in.</p>
      <CodeBlock
        code={`import { createSignal } from "solid-js";
import UserRound from "lucide-solid/icons/user-round";
import { ComboBox, type ClientOption } from "@kahitsan/ksui";

export default function BilledTo() {
  const [client, setClient] = createSignal<ClientOption | null>(null);
  return (
    <ComboBox<ClientOption>
      selected={client()}
      onChange={setClient}
      search={async (q) => (await fetch(\`/api/clients?search=\${q}\`)).json().then((r) => r.data)}
      idOf={(c) => c.id}
      labelOf={(c) => c.name_raw}
      icon={UserRound}
      noun="client"
    />
  );
}`}
      />

      <h2>Theme and styling</h2>
      <p>
        KSUI does not ship its own theme. The components inherit colors and CSS from the app they run in, so they
        match whatever styling you already have. There is no theme provider to mount.
      </p>

      <h2>Usage conventions</h2>
      <ul class="feature-list">
        <li>
          <strong>Bare imports.</strong> Import from the package (<code>@kahitsan/ksui</code>). Extend a shared widget
          rather than copying and forking it.
        </li>
        <li>
          <strong>Controlled.</strong> The pickers are controlled: pass the current value plus an <code>onChange</code>.
        </li>
        <li>
          <strong>Self contained.</strong> Components ship their own primitives (Button, Modal, <code>confirm</code>,
          string match helpers) and inject their own CSS. They depend only on <code>solid-js</code> — no host kit to wire up.
        </li>
      </ul>

      <h2>SSR and SolidStart notes</h2>
      <p>
        The package ships source under a <code>solid</code> export condition so your vite-plugin-solid compiles it.
        Keep <code>solid-js</code> externalized in your build so the widgets render with a single Solid instance.
        A duplicate Solid runtime is the classic cause of dead reactivity.
      </p>

      <h2>Browser support and accessibility</h2>
      <p>
        Targets evergreen browsers (ES2022). The Modal traps Escape and backdrop dismissal and exposes
        <code>role="dialog"</code> with <code>aria-modal</code>; the pickers are keyboard navigable. Components accept
        an <code>ariaLabel</code> where a visible label is not present.
      </p>

      <h2>Components</h2>
      <p>
        Browse the kit: <A href="/components/button">Button</A>, <A href="/components/modal">Modal</A>,{" "}
        <A href="/components/combo-box">Combo Box</A>,{" "}
        <A href="/components/markdown-notes">Markdown Notes</A>.
      </p>

      <PageFooter path="/getting-started" />
    </article>
  );
}
