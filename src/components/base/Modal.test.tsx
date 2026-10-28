import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
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

  describe("sheet variant", () => {
    // jsdom has no showModal()/close(); stand them in so a stacked dialog is open.
    const proto = HTMLDialogElement.prototype;
    const original = { showModal: proto.showModal, close: proto.close };
    beforeEach(() => {
      proto.showModal = function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      };
      proto.close = function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      };
    });
    afterEach(() => {
      cleanup(); // unmount while the stubs still exist
      proto.showModal = original.showModal;
      proto.close = original.close;
    });

    it("calls onClose on Escape", () => {
      const onClose = vi.fn();
      render(() => (
        <Modal variant="sheet" onClose={onClose}>
          <p>sheet</p>
        </Modal>
      ));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("leaves Escape to a dialog opened on top of it", () => {
      const onSheetClose = vi.fn();
      const onDialogClose = vi.fn();
      const { container } = render(() => (
        <Modal variant="sheet" onClose={onSheetClose}>
          <Modal onClose={onDialogClose}>
            <button type="button">inside</button>
          </Modal>
        </Modal>
      ));
      const dialog = container.querySelector("dialog")!;
      expect(dialog.open).toBe(true);

      // A browser delivers Escape as keydown (bubbling to window) and then
      // fires cancel on the topmost modal dialog.
      dialog
        .querySelector("button")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));

      expect(onSheetClose).not.toHaveBeenCalled();
      expect(onDialogClose).toHaveBeenCalledOnce();
    });

    it("ignores an Escape keydown another handler already consumed", () => {
      const onClose = vi.fn();
      render(() => (
        <Modal variant="sheet" onClose={onClose}>
          <p>sheet</p>
        </Modal>
      ));
      const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      e.preventDefault();
      window.dispatchEvent(e);
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
