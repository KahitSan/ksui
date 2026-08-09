// The picker pages the list in from the server (page/limit) and delegates the
// search to it, so these assert the request contract as well as the rendering.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import VoucherPicker, { type VoucherOption } from "./VoucherPicker";

/** Captures every requested URL and serves pages out of `rows`. */
function mockPagedFetch(rows: VoucherOption[]) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string) => {
    calls.push(url);
    const parsed = new URL(url, "http://localhost");
    const page = Number(parsed.searchParams.get("page") ?? "1");
    const limit = Number(parsed.searchParams.get("limit") ?? "25");
    const search = (parsed.searchParams.get("search") ?? "").toLowerCase();
    const matched = search
      ? rows.filter((r) => r.code.toLowerCase().includes(search))
      : rows;
    const start = (page - 1) * limit;
    return {
      ok: true,
      json: async () => ({
        data: matched.slice(start, start + limit),
        total: matched.length,
        page,
        limit,
      }),
    };
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", impl);
  return { impl, calls };
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

function manyVouchers(n: number): VoucherOption[] {
  return Array.from({ length: n }, (_, i) =>
    voucher({ id: i + 1, code: `BULK_${String(i + 1).padStart(3, "0")}` }),
  );
}

describe("VoucherPicker fetchUrl", () => {
  it("defaults to the vouchers plugin's own API when fetchUrl is omitted", async () => {
    const { calls } = mockPagedFetch([]);
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={100} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]).toContain("/api/vouchers");
    expect(calls[0]).toContain("status=active");
  });

  it("fetches the overridden URL when fetchUrl is provided", async () => {
    const { calls } = mockPagedFetch([]);
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

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]).toContain("/api/counter/vouchers");
  });

  it("requests only the first page up front, not the whole table", async () => {
    const { calls } = mockPagedFetch(manyVouchers(120));
    const { getByTestId, getAllByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() =>
      expect(getAllByTestId(/^voucher-picker-result-/).length).toBeGreaterThan(0),
    );
    expect(calls[0]).toContain("page=1");
    expect(calls[0]).toContain("limit=25");
    // 120 rows exist but only the first page is mounted.
    expect(getAllByTestId(/^voucher-picker-result-/).length).toBe(25);
  });
});

describe("VoucherPicker dialog", () => {
  it("opens a dialog and only commits the pick on Confirm", async () => {
    mockPagedFetch([voucher({ id: 1, code: "SAVE20" })]);
    const onChange = vi.fn();
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={onChange} subtotal={1000} packageIds={[]} />
    ));

    expect(queryByTestId("voucher-picker-popup")).toBeNull();
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(getByTestId("voucher-picker-result-1")).toBeTruthy());
    expect(getByTestId("voucher-picker-popup").closest("dialog")).not.toBeNull();

    // Staging a row must not reach the consumer yet.
    fireEvent.click(getByTestId("voucher-picker-result-1"));
    expect(onChange).not.toHaveBeenCalled();
    expect(getByTestId("voucher-picker-draft-summary").textContent).toContain("SAVE20");

    fireEvent.click(getByTestId("voucher-picker-confirm"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 1, code: "SAVE20" }));
    await waitFor(() => expect(queryByTestId("voucher-picker-popup")).toBeNull());
  });

  it("discards the staged pick on Cancel", async () => {
    mockPagedFetch([voucher({ id: 1, code: "SAVE20" })]);
    const onChange = vi.fn();
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={onChange} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-result-1")).toBeTruthy());

    fireEvent.click(getByTestId("voucher-picker-result-1"));
    fireEvent.click(getByTestId("voucher-picker-cancel"));

    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(queryByTestId("voucher-picker-popup")).toBeNull());
  });

  it("re-tapping the staged row unstages it", async () => {
    mockPagedFetch([voucher({ id: 1, code: "SAVE20" })]);
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-result-1")).toBeTruthy());

    fireEvent.click(getByTestId("voucher-picker-result-1"));
    expect(getByTestId("voucher-picker-draft-summary").textContent).toContain("SAVE20");

    fireEvent.click(getByTestId("voucher-picker-result-1"));
    expect(getByTestId("voucher-picker-draft-summary").textContent).toContain("No voucher selected");
  });

  it("delegates the search to the server and highlights the match", async () => {
    const { calls } = mockPagedFetch([
      voucher({ id: 1, code: "SAVE20" }),
      voucher({ id: 2, code: "PARTNER_ACES" }),
    ]);
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-result-1")).toBeTruthy());

    fireEvent.input(getByTestId("voucher-picker-search"), { target: { value: "partner" } });

    await waitFor(() => expect(calls.some((u) => u.includes("search=partner"))).toBe(true));
    await waitFor(() => expect(queryByTestId("voucher-picker-result-1")).toBeNull());

    const row = getByTestId("voucher-picker-result-2");
    const mark = row.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark!.textContent?.toLowerCase()).toBe("partner");
  });

  it("shows when a voucher expires", async () => {
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    mockPagedFetch([voucher({ id: 9, code: "ENDINGSOON", valid_until: soon })]);
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(getByTestId("voucher-picker-result-9")).toBeTruthy());
    expect(getByTestId("voucher-picker-result-9").textContent).toContain("Expires in 3 days");
  });

  it("reads a full timestamp date the same as a bare date", async () => {
    const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    mockPagedFetch([
      voucher({ id: 10, code: "TIMESTAMPED", valid_until: `${soon}T16:00:00.000Z` }),
    ]);
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(getByTestId("voucher-picker-result-10")).toBeTruthy());
    const text = getByTestId("voucher-picker-result-10").textContent ?? "";
    expect(text).toContain("Expires in 3 days");
    expect(text).not.toContain("T16:00:00");
  });

  it("shows how many redemptions are used against the limit", async () => {
    mockPagedFetch([
      voucher({ id: 20, code: "LIMITED", usage_count: 3, usage_limit_total: 10 }),
    ]);
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(getByTestId("voucher-picker-result-20")).toBeTruthy());
    expect(getByTestId("voucher-picker-result-20").textContent).toContain("3/10 used");
  });

  it("omits the usage line for an unlimited voucher", async () => {
    mockPagedFetch([voucher({ id: 21, code: "UNLIMITED", usage_count: 42 })]);
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(getByTestId("voucher-picker-result-21")).toBeTruthy());
    expect(getByTestId("voucher-picker-result-21").textContent).not.toContain("used");
  });

  it("blocks a fully-redeemed voucher the same way the server does", async () => {
    mockPagedFetch([
      voucher({ id: 22, code: "SPENT", usage_count: 10, usage_limit_total: 10 }),
    ]);
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(getByTestId("voucher-picker-inapplicable-22")).toBeTruthy());
    // Never selectable — it would be rejected at charge time.
    expect(queryByTestId("voucher-picker-result-22")).toBeNull();
    expect(getByTestId("voucher-picker-inapplicable-22").textContent).toContain("Fully redeemed");
  });

  it("explains why an ineligible voucher can't be used", async () => {
    mockPagedFetch([voucher({ id: 7, code: "BIGSPEND", minimum_purchase: 5000 })]);
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(getByTestId("voucher-picker-inapplicable-7")).toBeTruthy());
    expect(getByTestId("voucher-picker-inapplicable-7").textContent).toContain("minimum");
  });

  it("previews a discount range while nothing is priced yet", async () => {
    mockPagedFetch([voucher({ id: 3, code: "SAVE20" })]);
    const { getByTestId } = render(() => (
      <VoucherPicker
        selected={null}
        onChange={vi.fn()}
        subtotal={0}
        subtotalRange={{ min: 99, max: 118 }}
        packageIds={[]}
      />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(getByTestId("voucher-picker-result-3")).toBeTruthy());
    // 20% of 99 and of 118, both rounded the same way the server rounds.
    expect(getByTestId("voucher-picker-result-3").textContent).toContain("₱20.00 to ₱24.00");
  });

  it("shows a single amount once the cart has a real subtotal", async () => {
    mockPagedFetch([voucher({ id: 4, code: "SAVE20" })]);
    const { getByTestId } = render(() => (
      <VoucherPicker
        selected={null}
        onChange={vi.fn()}
        subtotal={99}
        subtotalRange={{ min: 99, max: 118 }}
        packageIds={[]}
      />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(getByTestId("voucher-picker-result-4")).toBeTruthy());
    const text = getByTestId("voucher-picker-result-4").textContent ?? "";
    expect(text).toContain("₱20.00");
    expect(text).not.toContain("₱24.00");
  });

  it("keeps Escape from reaching an ancestor's document-level dismiss handler", async () => {
    mockPagedFetch([]);
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
