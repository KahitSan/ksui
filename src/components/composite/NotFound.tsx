// Centered 404 / empty-state panel: an optional logo slot, a large display
// title, a heading, a message, and a default "go back" action button. It is a
// fully prop-driven, domain-free primitive — every piece of copy defaults to a
// generic 404 string but is overridable, and nothing about any specific site
// is hard-coded.
//
// Unlike the host-owned Button, this is a standalone primitive: it imports only
// solid-js and lucide-solid, never the host UI kit or a router. The default
// action renders a plain, self-styled button. Navigation is left to the caller
// via `onButtonClick` (or `href`, which renders an anchor instead). Callers who
// want the host Button can pass it through the `action` slot, which fully
// replaces the built-in button.

import type { JSX } from "solid-js";
import { Show, splitProps } from "solid-js";
import { ArrowLeft } from "lucide-solid";

export interface NotFoundProps
  extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Large display title. Defaults to "404". Pass "" to hide it entirely. */
  title?: string;
  /** Secondary heading under the title. Defaults to "Page Not Found". */
  heading?: string;
  /** Supporting message under the heading. */
  message?: string;
  /** Label for the default action button. Defaults to "Go Back Home". */
  buttonText?: string;
  /**
   * When set, the default action renders as an anchor pointing here instead of
   * a button. Ignored when `onButtonClick` or `action` is provided.
   */
  href?: string;
  /** Click handler for the default action button. */
  onButtonClick?: () => void;
  /** Optional element rendered above the title (e.g. a logo or icon). */
  logo?: JSX.Element;
  /** Hide the action entirely. */
  hideButton?: boolean;
  /**
   * Replace the built-in action with a custom element (e.g. the host Button).
   * When provided, `buttonText`, `href`, and `onButtonClick` are ignored.
   */
  action?: JSX.Element;
  /** Test id applied to the outer container. */
  testId?: string;
}

export default function NotFound(props: NotFoundProps): JSX.Element {
  const [local, others] = splitProps(props, [
    "title",
    "heading",
    "message",
    "buttonText",
    "href",
    "onButtonClick",
    "logo",
    "hideButton",
    "action",
    "testId",
    "class",
  ]);

  const showTitle = () => local.title !== "";
  const buttonClass =
    "inline-flex items-center justify-center gap-2 rounded-md border " +
    "border-amber-600/60 bg-amber-600/20 px-5 py-2.5 text-sm font-semibold " +
    "text-amber-400 transition-colors hover:border-amber-500 " +
    "hover:bg-amber-600/30 focus:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-amber-500/60";

  return (
    <div
      class={
        "flex items-center justify-center min-h-screen" +
        (local.class ? " " + local.class : "")
      }
      data-testid={local.testId}
      {...others}
    >
      <div class="text-center">
        <Show when={local.logo}>
          <div class="flex items-center justify-center mx-auto mb-6">{local.logo}</div>
        </Show>

        <Show when={showTitle()}>
          <h1 class="text-4xl md:text-6xl font-bold text-amber-500 mb-4">
            {local.title || "404"}
          </h1>
        </Show>

        <h2 class="text-xl md:text-2xl font-bold text-white mb-3">
          {local.heading || "Page Not Found"}
        </h2>

        <p class="text-sm text-zinc-400 max-w-md mb-8">
          {local.message ||
            "The page you're looking for doesn't exist or has been moved."}
        </p>

        <Show when={!local.hideButton}>
          <Show
            when={local.action}
            fallback={
              <Show
                when={local.href && !local.onButtonClick}
                fallback={
                  <button
                    type="button"
                    class={buttonClass}
                    onClick={() => local.onButtonClick?.()}
                  >
                    <ArrowLeft size={16} aria-hidden="true" />
                    {local.buttonText || "Go Back Home"}
                  </button>
                }
              >
                <a href={local.href} class={buttonClass}>
                  <ArrowLeft size={16} aria-hidden="true" />
                  {local.buttonText || "Go Back Home"}
                </a>
              </Show>
            }
          >
            {local.action}
          </Show>
        </Show>
      </div>
    </div>
  );
}
