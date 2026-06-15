import { type JSX } from "solid-js";
import AccountAvatarBasic from "../examples/account-avatar-basic";
import src from "../examples/account-avatar-basic.tsx?raw";
import { Example } from "../components/Example";
import { CodeBlock } from "../components/CodeBlock";
import { PageFooter } from "../components/PageFooter";

export default function AccountAvatarPage(): JSX.Element {
  return (
    <article>
      <h1>Account Avatar</h1>
      <p class="lead">
        A small square or round chip that pictures an account or a person. For a financial account it shows the uploaded
        logo or a chosen icon in a rounded square. For a user it shows the profile photo or an initials on color circle.
        The helpers <code>getInitials</code>, <code>getAvatarColor</code> and <code>buildInitialsSvg</code> build those
        initials and colors yourself.
      </p>

      <h2>Import</h2>
      <div class="import-snippet">
        <CodeBlock
          code={`import { AccountAvatar, getInitials, getAvatarColor, buildInitialsSvg, type AvatarAccount } from "@kahitsan/ksui";`}
        />
      </div>

      <h2>Basic</h2>
      <Example
        title="User initials, account icon, and a named account"
        description="Fully live, no backend needed. A user record renders initials on a color picked deterministically from the name; an account with an icon slug renders the lucide glyph; a named account with no logo or icon falls back to a type glyph. Pass an https s3_link or image to show a real logo or photo."
        render={() => <AccountAvatarBasic />}
        code={src}
      />

      <h2>Props</h2>
      <table class="props-table">
        <thead>
          <tr><th>Prop</th><th>Type</th><th>Default</th></tr>
        </thead>
        <tbody>
          <tr><td><code>account</code></td><td><code>AvatarAccount</code></td><td>required</td></tr>
          <tr><td><code>size</code></td><td><code>number</code></td><td><code>28</code></td></tr>
          <tr><td><code>class</code></td><td><code>string</code></td><td>n/a</td></tr>
          <tr><td><code>iconClass</code></td><td><code>string</code></td><td><code>text-zinc-300</code></td></tr>
          <tr><td><code>alt</code></td><td><code>string</code></td><td>n/a</td></tr>
          <tr><td><code>variant</code></td><td><code>'account' | 'user'</code></td><td>derived from type</td></tr>
        </tbody>
      </table>

      <PageFooter path="/components/account-avatar" />
    </article>
  );
}
