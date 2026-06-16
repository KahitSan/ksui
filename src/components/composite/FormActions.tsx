// Cancel / Submit modal footer row, composing ksui's own Button.
//
// The same footer is repeated across plugin modals: a
// `flex flex-col-reverse sm:flex-row gap-2 sm:justify-end` row with a
// secondary Cancel button and a primary submit button (often disabled while
// saving, sometimes with a leading icon). This promotes that footer layout and
// the standard Cancel/Submit wiring, leaving all domain concerns (labels,
// handlers, saving state, optional icon) as props. No fetch/API call lives
// here — the caller owns the submit handler.
//
// ModalShell is deliberately NOT promoted: the ksui Modal already supplies the
// backdrop, card, title/close-X path, aria-modal, focus trap, size and tone
// tokens. Only the body chrome the Modal does not cover (FormErrorBanner +
// FormActions) is promoted.

import type { JSX } from "solid-js";
import { Show } from "solid-js";
import Button from "../base/Button";

export interface FormActionsProps {
  /** Invoked when the Cancel button is clicked. */
  onCancel: () => void;
  /**
   * Invoked when the Submit button is clicked. Omit when `submitType="submit"`
   * and let the wrapping <form> handle submission.
   */
  onSubmit?: () => void;
  /** Primary button label. Defaults to "Save". */
  submitLabel?: string;
  /** Secondary button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** When true, disables the submit button (in-flight save). */
  submitting?: boolean;
  /** Extra condition to disable the submit button. */
  submitDisabled?: boolean;
  /** Optional leading icon rendered before the submit label. */
  submitIcon?: JSX.Element;
  /**
   * Button type for the submit action. Defaults to "button" (handler-driven).
   * Set to "submit" to let a wrapping <form> handle the action; in that case
   * `onSubmit` is ignored.
   */
  submitType?: "button" | "submit";
  /** Swap the primary button to a destructive tone. */
  danger?: boolean;
  /** Extra classes appended to the footer row. */
  class?: string;
}

export default function FormActions(props: FormActionsProps): JSX.Element {
  const isSubmitType = () => props.submitType === "submit";
  return (
    <div
      class={
        "flex flex-col-reverse sm:flex-row gap-2 sm:justify-end" +
        (props.class ? " " + props.class : "")
      }
    >
      <Button
        type="button"
        onClick={props.onCancel}
        intent="secondary"
        class="w-full sm:w-auto"
      >
        {props.cancelLabel ?? "Cancel"}
      </Button>
      <Button
        type={isSubmitType() ? "submit" : "button"}
        onClick={isSubmitType() ? undefined : props.onSubmit}
        disabled={(props.submitting ?? false) || (props.submitDisabled ?? false)}
        intent={props.danger ? "danger" : "primary"}
        class="gap-2 w-full sm:w-auto"
      >
        <Show when={props.submitIcon}>{props.submitIcon}</Show>
        {props.submitLabel ?? "Save"}
      </Button>
    </div>
  );
}
