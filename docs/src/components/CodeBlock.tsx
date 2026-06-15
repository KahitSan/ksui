import { createSignal, createResource, Show, type JSX } from "solid-js";
import Copy from "lucide-solid/icons/copy";
import Check from "lucide-solid/icons/check";
import { highlight, stripExampleBoilerplate } from "../lib/highlight";

interface CodeBlockProps {
  code: string;
  lang?: "tsx" | "bash";
  // When true the docs boilerplate above `// example-start` is stripped.
  stripBoilerplate?: boolean;
}

export function CodeBlock(props: CodeBlockProps): JSX.Element {
  const source = () => (props.stripBoilerplate ? stripExampleBoilerplate(props.code) : props.code.trim());
  const [html] = createResource(
    () => ({ src: source(), lang: props.lang ?? "tsx" }),
    (args) => highlight(args.src, args.lang),
  );
  const [copied, setCopied] = createSignal(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; ignore
    }
  };

  return (
    <div class="code-block">
      <button class="code-copy" type="button" onClick={copy} aria-label="Copy code">
        <Show when={copied()} fallback={<Copy size={15} />}>
          <Check size={15} />
        </Show>
      </button>
      <Show when={html()} fallback={<pre class="code-pre-fallback">{source()}</pre>}>
        <div innerHTML={html()} />
      </Show>
    </div>
  );
}
