// Promise-based confirm dialog. Ported into ksui from the former host kit so the
// library is self-contained: ExistingAttachmentTile used to import `confirm`
// from "@kserp/host-ui"; it now imports it from here.
//
// Renders a ksui Modal + Buttons imperatively (outside any component tree) into
// a transient container appended to <body>, resolves the returned promise when
// the user confirms/cancels/dismisses, then tears the container down. No host
// kit, no Tailwind — Modal and Button inject their own styles.

import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import Modal from "../components/base/Modal";
import Button from "../components/base/Button";

export interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Tints the dialog + confirm button for destructive actions. */
  danger?: boolean;
}

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  // SSR / non-DOM: no way to ask, so default to "no".
  if (typeof document === "undefined") return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);

    const [open, setOpen] = createSignal(true);
    let settled = false;
    let dispose = () => {};

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      setOpen(false);
      // Let the Modal run its unmount/cleanup before yanking the container.
      queueMicrotask(() => {
        dispose();
        host.remove();
        resolve(result);
      });
    };

    dispose = render(
      () => (
        <Show when={open()}>
          <Modal
            onClose={() => finish(false)}
            size="sm"
            tone={opts.danger ? "danger" : "default"}
            ariaLabel={opts.title ?? "Confirm"}
          >
            <div data-testid="confirm-dialog" style={{ display: "flex", "flex-direction": "column", gap: "0.75rem" }}>
              <Show when={opts.title}>
                <h2 style={{ margin: 0, "font-size": "1.125rem", "font-weight": 600 }}>{opts.title}</h2>
              </Show>
              <Show when={opts.message}>
                <p style={{ margin: 0, "font-size": "0.875rem", opacity: 0.85 }}>{opts.message}</p>
              </Show>
              <div style={{ display: "flex", "justify-content": "flex-end", gap: "0.5rem", "margin-top": "0.5rem" }}>
                <Button type="button" intent="secondary" variant="ghost" onClick={() => finish(false)}>
                  {opts.cancelLabel ?? "Cancel"}
                </Button>
                <Button
                  type="button"
                  intent={opts.danger ? "danger" : "primary"}
                  variant="clip1"
                  onClick={() => finish(true)}
                >
                  {opts.confirmLabel ?? "Confirm"}
                </Button>
              </div>
            </div>
          </Modal>
        </Show>
      ),
      host,
    );
  });
}
