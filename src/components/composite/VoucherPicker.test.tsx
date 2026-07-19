// fetchUrl prop threading — the default stays the vouchers plugin's own API so
// existing consumers are unaffected; a consumer without vouchers.view can
// point the picker at a peer proxy route with the same response shape.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import VoucherPicker from "./VoucherPicker";

function mockFetchOnce(): typeof fetch {
  const impl = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: [] }),
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", impl);
  return impl;
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
