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
        <code>/api/financial-accounts</code> to build the index, so it needs both a host kit and a backend at run time.
        The pure helpers <code>resolveAccount</code> and <code>resolveAccountName</code> take a plain index object and
        do no fetching, so you can call them anywhere as long as you hand them an index of the same{" "}
        <code>{"{ byId, nameById }"}</code> shape the hook resolves to.
      </p>

      <h2>Basic</h2>
      <Example
        title="Resolving ids against an index"
        description="resolveAccount turns each id into an AvatarAccount, or a generic external-account placeholder when the id is missing, the same fallback a deleted or not-yet-loaded account takes. resolveAccountName turns an id into its display name."
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
