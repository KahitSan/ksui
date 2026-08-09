// fetchUrl prop threading — the default stays the vouchers plugin's own API so
// existing consumers are unaffected; a consumer without vouchers.view can
// point the picker at a peer proxy route with the same response shape.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import VoucherPicker, { type VoucherOption } from "./VoucherPicker";

function mockFetchOnce(): typeof fetch {
  const impl = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: [] }),
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", impl);
  return impl;
}

function mockFetchWith(data: VoucherOption[]): typeof fetch {
  const impl = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data }),
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", impl);
  return impl;
}

function voucher(over: Partial<VoucherOption> & Pick<VoucherOption, "id" | "code">): VoucherOption {
  return {
    type: "percentage",
    value: 20,
    max_discount_amount: null,
    applicable_packages: null,
    minimum_purchase: 0,
    valid_from: null,
    valid_until: null,
    is_active: true,
    ...over,
  };
}

describe("VoucherPicker fetchUrl", () => {
  it("defaults to the vouchers plugin's own API when fetchUrl is omitted", async () => {
    const fetchMock = mockFetchOnce();
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={100} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/vouchers?status=active&limit=200",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("fetches the overridden URL when fetchUrl is provided", async () => {
    const fetchMock = mockFetchOnce();
    const { getByTestId } = render(() => (
      <VoucherPicker
        selected={null}
        onChange={vi.fn()}
        subtotal={100}
        packageIds={[]}
        fetchUrl="/api/counter/vouchers"
      />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/counter/vouchers",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});

describe("VoucherPicker dialog", () => {
  it("opens a dialog rather than an inline listbox, and closes on selection", async () => {
    mockFetchWith([voucher({ id: 1, code: "SAVE20" })]);
    const onChange = vi.fn();
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={onChange} subtotal={1000} packageIds={[]} />
    ));

    expect(queryByTestId("voucher-picker-popup")).toBeNull();
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(getByTestId("voucher-picker-result-1")).toBeTruthy());
    // The picker surface is now inside a real dialog element.
    expect(getByTestId("voucher-picker-popup").closest("dialog")).not.toBeNull();

    fireEvent.click(getByTestId("voucher-picker-result-1"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 1, code: "SAVE20" }));
    await waitFor(() => expect(queryByTestId("voucher-picker-popup")).toBeNull());
  });

  it("filters the list by code as the cashier types", async () => {
    mockFetchWith([
      voucher({ id: 1, code: "SAVE20" }),
      voucher({ id: 2, code: "PARTNER_ACES" }),
    ]);
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-result-1")).toBeTruthy());

    fireEvent.input(getByTestId("voucher-picker-search"), { target: { value: "partner" } });

    await waitFor(() => expect(queryByTestId("voucher-picker-result-1")).toBeNull());
    expect(getByTestId("voucher-picker-result-2")).toBeTruthy();
  });

  it("explains why an ineligible voucher can't be used", async () => {
    mockFetchWith([voucher({ id: 7, code: "BIGSPEND", minimum_purchase: 5000 })]);
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(getByTestId("voucher-picker-inapplicable-7")).toBeTruthy());
    expect(getByTestId("voucher-picker-inapplicable-7").textContent).toContain("minimum");
  });

  it("keeps Escape from reaching an ancestor's document-level dismiss handler", async () => {
    mockFetchWith([]);
    const ancestorEsc = vi.fn();
    document.addEventListener("keydown", ancestorEsc);

    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={100} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-popup")).toBeTruthy());

    fireEvent.keyDown(getByTestId("voucher-picker-search"), { key: "Escape" });
    expect(ancestorEsc).not.toHaveBeenCalled();

    document.removeEventListener("keydown", ancestorEsc);
  });
});
