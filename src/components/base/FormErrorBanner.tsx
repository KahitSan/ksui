import { Show, type JSX } from "solid-js";

interface FormErrorBannerProps {
  /** The error message to display. When falsy (null / undefined / empty
   *  string) the banner renders nothing, so callers do not need to wrap
   *  it in their own <Show>. */
  message: string | null | undefined;
  /** Extra classes on the banner. Use this for margin spacing such as
   *  "mt-3" or "mb-3" — the banner ships no margin of its own. */
  class?: string;
}

// Standard form error banner: the red role="alert" box that nearly every
// create/edit modal hand-rolls. Self-guarding — it renders nothing when the
// message is falsy, so a surrounding <Show> is unnecessary.
export default function FormErrorBanner(props: FormErrorBannerProps): JSX.Element {
  return (
    <Show when={props.message}>
      <div
        role="alert"
        class={`rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 ${props.class ?? ""}`}
      >
        {props.message}
      </div>
    </Show>
  );
}
