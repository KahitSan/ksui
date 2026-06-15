import { type JSX } from "solid-js";
import UseAccountsIndexBasic from "../examples/use-accounts-index-basic";
import src from "../examples/use-accounts-index-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function UseAccountsIndexPage(): JSX.Element {
  return (
    <article>
      <h1>useAccountsIndex / resolveAccount / resolveAccountName</h1>
      <p class="lead">
        A data helper for looking up financial accounts by id. <code>useAccountsIndex</code> loads all accounts once for
        the active workspace and keeps them in a shared in memory map. <code>resolveAccount</code> turns an id into a
        drawable account object for <code>AccountAvatar</code>, and <code>resolveAccountName</code> turns an id into the
        account's display name.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock code={`import { useAccountsIndex, resolveAccount, resolveAccountName } from "@kahitsan/ksui";`} />
      </div>

      <h2>Note</h2>
      <p>
        <code>useAccountsIndex</code> is a live data hook: it reads the active workspace from the host kit and fetches{" "}
        <code>/api/financial-accounts</code> to build the index, so it cannot render on its own in a static docs page
        without mocking both. The pure helpers <code>resolveAccount</code> and <code>resolveAccountName</code> are
        render only and take a plain index object, so the demo below feeds them a hand built index that is shaped
        exactly like what the hook resolves to. That is an honest stand in, not the real fetch.
      </p>

      <h2>Basic</h2>
      <Example
        title="Resolving ids against a stubbed index"
        description="The fakeIndex map mirrors the { byId, nameById } shape useAccountsIndex() resolves to. resolveAccount turns each id into an AvatarAccount (or a placeholder for the unknown id), resolveAccountName turns it into a label. No backend or host mock needed for the helpers."
        render={() => <UseAccountsIndexBasic />}
        code={src}
      />

      <h2>Signatures</h2>
      <table class="props-table">
        <thead>
          <tr><th>Export</th><th>Type</th></tr>
        </thead>
        <tbody>
          <tr><td><code>useAccountsIndex()</code></td><td><code>() =&gt; Resource&lt;{"{ byId, nameById }"}&gt;</code></td></tr>
          <tr><td><code>resolveAccount(index, id)</code></td><td><code>(index, id) =&gt; AvatarAccount | null</code></td></tr>
          <tr><td><code>resolveAccountName(index, id)</code></td><td><code>(index, id) =&gt; string | null</code></td></tr>
        </tbody>
      </table>

      <PageFooter path="/components/use-accounts-index" />
    </article>
  );
}
