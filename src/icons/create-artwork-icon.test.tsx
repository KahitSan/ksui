import { cleanup, render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { createArtworkIcon } from "./create-artwork-icon";

const regular = "data:image/png;base64,regular";
const bold = "data:image/png;base64,bold";
const filled = "data:image/png;base64,filled";
const Glyph = createArtworkIcon("sample", regular, { bold, filled });
afterEach(cleanup);

describe("original artwork icon contract", () => {
  it("rotates shared source geometry without changing caller SVG transforms or children", () => {
    const Oriented = createArtworkIcon("left", "M72 12v120", { rotation: 90 });
    const view = render(() => <Oriented transform="translate(2 3)"><desc>Previous page</desc></Oriented>);
    expect(view.container.querySelector("svg")?.getAttribute("transform")).toBe("translate(2 3)");
    expect(view.container.querySelector("path")?.parentElement?.getAttribute("transform")).toBe("rotate(90 72 72)");
    expect(view.container.querySelector("desc")?.parentElement?.tagName.toLowerCase()).toBe("svg");
  });
  it("keeps accessible titles in the SVG namespace without changing the document title", () => {
    const previousTitle = document.title;
    document.title = "Application";
    try {
      const view = render(() => <Glyph title="Search" />);
      const title = view.container.querySelector("title");
      expect(title?.namespaceURI).toBe("http://www.w3.org/2000/svg");
      expect(view.getByRole("img", { name: "Search" })).toBeTruthy();
      expect(document.title).toBe("Application");
    } finally {
      document.title = previousTitle;
    }
  });

  it("uses an emitted image URL without mistaking it for vector geometry", () => {
    const External = createArtworkIcon("external", { image: "/assets/original.png" });
    const view = render(() => <External title="Original image" />);
    expect(view.container.querySelector("path")).toBeNull();
    expect(view.container.querySelector("image")?.getAttribute("href")).toBe("/assets/original.png");
    expect(view.getByRole("img", { name: "Original image" })).toBeTruthy();
  });

  it("changes delivery format when a reactive weight selects different artwork", () => {
    const Mixed = createArtworkIcon("mixed", regular, {
      bold: "M12 12h120v120H12z",
    });
    const [weight, setWeight] = createSignal(2);
    const view = render(() => <Mixed strokeWidth={weight()} />);
    expect(view.container.querySelector("image")).not.toBeNull();
    setWeight(3);
    flush();
    expect(view.container.querySelector("image")).toBeNull();
    expect(view.container.querySelector("path")).not.toBeNull();
  });
  it("renders verified vector artwork without creating image requests", () => {
    const Vector = createArtworkIcon("vector", "M12 12h120v120H12z");
    const view = render(() => (
      <Vector aria-label="Vector sample" style={{ color: "red" }} />
    ));
    expect(view.getByRole("img", { name: "Vector sample" })).toBeTruthy();
    expect(view.container.querySelector("image")).toBeNull();
    expect(view.container.querySelector("path")?.getAttribute("fill")).toBe(
      "currentColor"
    );
  });
  it("retains SVG refs, attributes and reactive dimensions", () => {
    const [size, setSize] = createSignal(16);
    let element: SVGSVGElement | undefined;
    const view = render(() => (
      <Glyph
        ref={element}
        size={size()}
        class="indicator"
        aria-label="Saved"
        data-testid="glyph"
      />
    ));
    const svg = view.getByTestId("glyph");
    expect(element).toBe(svg);
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.hasAttribute("aria-hidden")).toBe(false);
    setSize(24);
    flush();
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("class")).toContain("indicator");
  });

  it("uses independent alpha masks and connected accessible titles", () => {
    const view = render(() => (
      <>
        <Glyph title="Search" />
        <Glyph />
      </>
    ));
    const svg = view.container.querySelectorAll("svg");
    const masks = [...view.container.querySelectorAll("mask")];
    expect(new Set(masks.map((mask) => mask.id)).size).toBe(masks.length);
    expect(masks.every((mask) => mask.style.maskType === "alpha")).toBe(true);
    expect(svg[0].getAttribute("aria-labelledby")).toBe(
      svg[0].querySelector("title")?.id
    );
    expect(svg[1].getAttribute("aria-hidden")).toBe("true");
  });

  it("selects supplied bold artwork and preserves inherited filled artwork", () => {
    const [weight, setWeight] = createSignal(2);
    const view = render(() => (
      <Glyph strokeWidth={weight()} fill="currentColor" />
    ));
    const images = view.container.querySelectorAll("image");
    expect(images[0].getAttribute("href")).toBe(regular);
    setWeight(3);
    flush();
    expect(images[0].getAttribute("href")).toBe(bold);
    expect(images[1].getAttribute("href")).toBe(filled);
    expect(view.container.querySelector("svg")?.getAttribute("fill")).toBe(
      "currentColor"
    );
    expect(
      [...view.container.querySelectorAll("rect")].some(
        (rect) => rect.getAttribute("fill") === "inherit"
      )
    ).toBe(true);
  });
});
