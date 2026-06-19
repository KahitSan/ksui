import { describe, expect, it, vi } from "vitest";
import { render } from "@solidjs/testing-library";
import { Show, createSignal } from "solid-js";
import Modal from "./Modal";

// Modal is the most critical shared widget — it wraps a native <dialog> with
// focus trap, Escape handling, and backdrop-click dismissal. Every plugin's
// create/edit/void flow opens a Modal, so its behavior is the canonical
// dedup source: a plugin UI test must NOT re-assert that "Escape closes the
// modal" or "clicking the backdrop calls onClose".
//
// Modal has no `open` prop — mount === open, unmount === closed. Wrap in
// `<Show when={...}>` to control visibility (same pattern the plugins use).

describe("Modal", () => {
  it("renders children inside a dialog", () => {
    const { container } = render(() => (
      <Modal onClose={() => {}}>
        <p>modal content</p>
      </Modal>
    ));
    const dialog = container.querySelector("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute("aria-modal")).toBe("true");
    expect(dialog!.textContent).toContain("modal content");
  });

  it("calls onClose when Escape is pressed (dismissable by default)", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <Modal onClose={onClose}>
        <p>content</p>
      </Modal>
    ));
    const dialog = container.querySelector("dialog")!;
    dialog.dispatchEvent(new KeyboardEvent("cancel", { bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does NOT call onClose when dismissable=false", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <Modal onClose={onClose} dismissable={false}>
        <p>content</p>
      </Modal>
    ));
    const dialog = container.querySelector("dialog")!;
    dialog.dispatchEvent(new KeyboardEvent("cancel", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sets the requested size as max-width on the card", () => {
    const { container } = render(() => (
      <Modal onClose={() => {}} size="sm">
        <p>sized</p>
      </Modal>
    ));
    const card = container.querySelector(".ksui-modal-card")!;
    expect(card.getAttribute("style")).toContain("max-width");
  });

  it("applies danger tone class when tone='danger'", () => {
    const { container } = render(() => (
      <Modal onClose={() => {}} tone="danger">
        <p>danger</p>
      </Modal>
    ));
    const card = container.querySelector(".ksui-modal-card")!;
    expect(card.className).toContain("danger");
  });
});
