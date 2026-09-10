import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImageViewer from "./ImageViewer";

describe("ImageViewer", () => {
  afterEach(() => cleanup());

  it("reserves viewer space before the image loads", () => {
    const showModal = vi.fn();
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: showModal });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: vi.fn() });
    const view = render(() => <ImageViewer src="blob:test" alt="Receipt" onClose={vi.fn()} />);
    const frame = view.container.querySelector<HTMLElement>(".ksui-imgviewer-frame");
    const image = view.container.querySelector<HTMLImageElement>("img");

    expect(frame).toBeTruthy();
    expect(frame?.className).toContain("ksui-imgviewer-frame");
    expect(image?.style.opacity).toBe("0");
    expect(showModal).toHaveBeenCalledTimes(1);

    fireEvent.load(image!);
    expect(image?.style.opacity).toBe("1");

  });
});
