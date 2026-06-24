// U8 — CustomRenderer component tests: registered renders, unknown id falls back,
// mismatched props fall back, undeclared emit is dropped.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import CustomRenderer from "./CustomRenderer";
import { clearRenderers, registerRenderer, type RendererProps } from "../../utils/renderers";

afterEach(() => {
  clearRenderers();
  vi.restoreAllMocks();
});

function Card(props: RendererProps) {
  return (
    <div data-testid="card">
      <span>{String(props.item.customer)}</span>
      <button data-testid="emit-pay" onClick={() => props.emit("pay", { amount: 1 })}>
        pay
      </button>
      <button data-testid="emit-bogus" onClick={() => props.emit("bogus")}>
        bogus
      </button>
    </div>
  );
}

describe("CustomRenderer", () => {
  it("renders a registered renderer with valid props", () => {
    registerRenderer({ id: "card", consumes: { customer: "string" }, emits: ["pay"], render: Card });
    const { getByTestId } = render(() => <CustomRenderer id="card" item={{ customer: "Acme" }} />);
    expect(getByTestId("card").textContent).toContain("Acme");
  });

  it("falls back when the id is unregistered", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getByTestId, queryByTestId } = render(() => (
      <CustomRenderer id="missing" item={{ customer: "Acme" }} />
    ));
    expect(getByTestId("ksui-cr-fallback")).toBeTruthy();
    expect(queryByTestId("card")).toBeNull();
  });

  it("falls back when props don't match the consumes contract", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    registerRenderer({ id: "card", consumes: { customer: "string" }, emits: ["pay"], render: Card });
    const { getByTestId, queryByTestId } = render(() => (
      <CustomRenderer id="card" item={{ customer: 123 as unknown as string }} />
    ));
    expect(getByTestId("ksui-cr-fallback")).toBeTruthy();
    expect(queryByTestId("card")).toBeNull();
  });

  it("forwards a declared emit to onEmit", () => {
    registerRenderer({ id: "card", consumes: { customer: "string" }, emits: ["pay"], render: Card });
    const onEmit = vi.fn();
    const { getByTestId } = render(() => (
      <CustomRenderer id="card" item={{ customer: "Acme" }} onEmit={onEmit} />
    ));
    fireEvent.click(getByTestId("emit-pay"));
    expect(onEmit).toHaveBeenCalledWith("pay", { amount: 1 });
  });

  it("drops an undeclared emit (cannot forge an interaction)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerRenderer({ id: "card", consumes: { customer: "string" }, emits: ["pay"], render: Card });
    const onEmit = vi.fn();
    const { getByTestId } = render(() => (
      <CustomRenderer id="card" item={{ customer: "Acme" }} onEmit={onEmit} />
    ));
    fireEvent.click(getByTestId("emit-bogus"));
    expect(onEmit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("renders a custom fallback when provided", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getByTestId } = render(() => (
      <CustomRenderer
        id="missing"
        item={{}}
        fallback={(p) => <div data-testid="my-fallback">{p.id}</div>}
      />
    ));
    expect(getByTestId("my-fallback").textContent).toBe("missing");
  });
});
