// The picker pages the list in from the server (page/limit) and delegates the
// search to it, so these assert the request contract as well as the rendering.
import { describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
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
      ? rows.filter((r) => `${r.code} ${r.notes ?? ""}`.toLowerCase().includes(search))
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
    applicable_package_lineages: null,
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

    // Staging a row must not reach the consumer yet; the footer no longer
    // repeats the code (it's in the listing), so the confirm enabling is the signal.
    fireEvent.click(getByTestId("voucher-picker-result-1"));
    expect(onChange).not.toHaveBeenCalled();
    expect(getByTestId("voucher-picker-confirm").hasAttribute("disabled")).toBe(false);

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
    expect(getByTestId("voucher-picker-confirm").hasAttribute("disabled")).toBe(false);

    fireEvent.click(getByTestId("voucher-picker-result-1"));
    expect(getByTestId("voucher-picker-confirm").hasAttribute("disabled")).toBe(true);
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

  it("shows the voucher description in the row and the footer draft", async () => {
    mockPagedFetch([
      voucher({ id: 50, code: "PARTNER_ACES", notes: "BISCAST ACES outreach discount" }),
    ]);
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(getByTestId("voucher-picker-result-50")).toBeTruthy());
    expect(getByTestId("voucher-picker-result-50").textContent).toContain(
      "BISCAST ACES outreach discount",
    );

    fireEvent.click(getByTestId("voucher-picker-result-50"));
    // The footer shows the description under the summary, beside the buttons.
    expect(getByTestId("voucher-picker-draft-description").textContent).toContain(
      "BISCAST ACES outreach discount",
    );
  });

  it("omits the footer description element when the voucher has no notes", async () => {
    mockPagedFetch([voucher({ id: 51, code: "PLAIN" })]);
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-result-51")).toBeTruthy());
    fireEvent.click(getByTestId("voucher-picker-result-51"));
    // The footer description row is gated on a trimmed notes value - a voucher
    // without notes must not leave an empty line beside Cancel/Apply.
    expect(queryByTestId("voucher-picker-draft-description")).toBeNull();
  });

  it("finds a voucher by its description and highlights the match in it", async () => {
    const { calls } = mockPagedFetch([
      voucher({ id: 51, code: "PARTNER_UAPGA", notes: "UAPGA Camarines Chapter discount" }),
      voucher({ id: 52, code: "GENERIC" }),
    ]);
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-result-51")).toBeTruthy());

    fireEvent.input(getByTestId("voucher-picker-search"), {
      target: { value: "camarines" },
    });

    await waitFor(() => expect(calls.some((u) => u.includes("search=camarines"))).toBe(true));
    await waitFor(() => expect(queryByTestId("voucher-picker-result-52")).toBeNull());

    const row = getByTestId("voucher-picker-result-51");
    const mark = row.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark!.textContent?.toLowerCase()).toBe("camarines");
  });

  it("skips the description line for a blank description", async () => {
    mockPagedFetch([
      voucher({ id: 53, code: "PLAIN", notes: "   " }),
      voucher({ id: 54, code: "PLAIN" }),
    ]);
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(getByTestId("voucher-picker-result-53")).toBeTruthy());
    // Identical rows — a whitespace-only description must render nothing extra.
    expect(getByTestId("voucher-picker-result-53").textContent).toBe(
      getByTestId("voucher-picker-result-54").textContent,
    );
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

  it("names the specific reason each ineligible voucher can't be used", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    mockPagedFetch([
      voucher({ id: 30, code: "TOO_SMALL", minimum_purchase: 5000 }),
      voucher({ id: 31, code: "GONE", valid_until: yesterday }),
      voucher({ id: 32, code: "NOT_YET", valid_from: nextWeek }),
      voucher({ id: 33, code: "OFF", is_active: false }),
      voucher({ id: 34, code: "OTHER_ITEMS", applicable_packages: [99] }),
    ]);
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[1]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() => expect(getByTestId("voucher-picker-inapplicable-30")).toBeTruthy());
    expect(getByTestId("voucher-picker-inapplicable-30").textContent).toContain("minimum");
    expect(getByTestId("voucher-picker-inapplicable-31").textContent).toContain("Expired");
    expect(getByTestId("voucher-picker-inapplicable-32").textContent).toContain("Starts");
    expect(getByTestId("voucher-picker-inapplicable-33").textContent).toContain("Inactive");
    expect(getByTestId("voucher-picker-inapplicable-34").textContent).toContain(
      "Doesn't cover every item",
    );
  });

  it("accepts a voucher when each package matches by aligned lineage", async () => {
    mockPagedFetch([
      voucher({
        id: 35,
        code: "LINEAGEOK",
        applicable_packages: [99],
        applicable_package_lineages: ["day-pass"],
      }),
    ]);
    const { getByTestId } = render(() => (
      <VoucherPicker
        selected={null}
        onChange={vi.fn()}
        subtotal={1000}
        packageIds={[1]}
        packageLineages={["day-pass"]}
      />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-result-35")).toBeTruthy());
  });

  it("accepts mixed carts when every item matches one of several allowed pricing eras", async () => {
    mockPagedFetch([
      voucher({
        id: 55,
        code: "MULTI_ERA",
        applicable_package_lineages: ["day-pass", "single-use"],
      }),
    ]);
    const { getByTestId } = render(() => (
      <VoucherPicker
        selected={null}
        onChange={vi.fn()}
        subtotal={1000}
        packageIds={[1, 2, 3]}
        packageLineages={["day-pass", "single-use", "day-pass"]}
      />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-result-55")).toBeTruthy());
  });

  it("rejects a mixed ID and lineage cart when one item matches neither", async () => {
    mockPagedFetch([
      voucher({
        id: 56,
        code: "MIXED_NEITHER",
        applicable_packages: [1],
        applicable_package_lineages: ["day-pass"],
      }),
    ]);
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker
        selected={null}
        onChange={vi.fn()}
        subtotal={1000}
        packageIds={[1, 2, 3]}
        packageLineages={[null, "day-pass", "single-use"]}
      />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-inapplicable-56")).toBeTruthy());
    expect(queryByTestId("voucher-picker-result-56")).toBeNull();
    expect(getByTestId("voucher-picker-inapplicable-56").textContent).toContain(
      "Doesn't cover every item",
    );
  });

  it("does not keep a selected voucher selectable after reopening with a changed lineage", async () => {
    const selected = voucher({
      id: 57,
      code: "CHANGED_ERA",
      applicable_package_lineages: ["day-pass"],
    });
    mockPagedFetch([selected]);
    const [packageLineage, setPackageLineage] = createSignal<string | null>("day-pass");
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker
        selected={selected}
        onChange={vi.fn()}
        subtotal={1000}
        packageIds={[1]}
        packageLineages={[packageLineage()]}
      />
    ));

    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-result-57")).toBeTruthy());
    fireEvent.click(getByTestId("voucher-picker-cancel"));

    setPackageLineage("single-use");
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-inapplicable-57")).toBeTruthy());
    expect(queryByTestId("voucher-picker-result-57")).toBeNull();
    expect(getByTestId("voucher-picker-confirm").hasAttribute("disabled")).toBe(true);
  });

  it("keeps Confirm disabled when selected voucher is inactive", async () => {
    const selected = voucher({ id: 59, code: "DISABLED_SELECTED", is_active: false });
    mockPagedFetch([selected]);
    const onChange = vi.fn();
    const { getByTestId } = render(() => (
      <VoucherPicker
        selected={selected}
        onChange={onChange}
        subtotal={1000}
        packageIds={[]}
      />
    ));

    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-inapplicable-59")).toBeTruthy());
    expect(getByTestId("voucher-picker-confirm").hasAttribute("disabled")).toBe(true);

    fireEvent.click(getByTestId("voucher-picker-confirm"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lists enabled and disabled vouchers in their correct modal sections", async () => {
    mockPagedFetch([
      voucher({ id: 37, code: "ENABLED_LINEAGE", applicable_packages: [99], applicable_package_lineages: ["day-pass"] }),
      voucher({ id: 38, code: "DISABLED_LINEAGE", is_active: false, applicable_packages: [99], applicable_package_lineages: ["day-pass"] }),
    ]);
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker
        selected={null}
        onChange={vi.fn()}
        subtotal={1000}
        packageIds={[1]}
        packageLineages={["day-pass"]}
      />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-result-37")).toBeTruthy());
    expect(queryByTestId("voucher-picker-inapplicable-37")).toBeNull();
    expect(getByTestId("voucher-picker-result-37").textContent).toContain("ENABLED_LINEAGE");
    expect(queryByTestId("voucher-picker-result-38")).toBeNull();
    expect(getByTestId("voucher-picker-inapplicable-38").textContent).toContain("DISABLED_LINEAGE");
    expect(getByTestId("voucher-picker-inapplicable-38").textContent).toContain("Inactive");
  });

  it("lists lineage-disabled vouchers as visible but not selectable", async () => {
    mockPagedFetch([
      voucher({ id: 39, code: "DISABLED_LINEAGE", applicable_packages: [99], applicable_package_lineages: ["day-pass"] }),
    ]);
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker
        selected={null}
        onChange={vi.fn()}
        subtotal={1000}
        packageIds={[1]}
        packageLineages={["single-use"]}
      />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-inapplicable-39")).toBeTruthy());
    expect(queryByTestId("voucher-picker-result-39")).toBeNull();
    expect(getByTestId("voucher-picker-inapplicable-39").getAttribute("aria-disabled")).toBe("true");
    expect(getByTestId("voucher-picker-inapplicable-39").textContent).toContain("DISABLED_LINEAGE");
    expect(getByTestId("voucher-picker-confirm").hasAttribute("disabled")).toBe(true);
  });

  it("rejects a voucher when aligned package lineage does not match", async () => {
    mockPagedFetch([
      voucher({
        id: 36,
        code: "LINEAGEBAD",
        applicable_packages: [99],
        applicable_package_lineages: ["day-pass"],
      }),
    ]);
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker
        selected={null}
        onChange={vi.fn()}
        subtotal={1000}
        packageIds={[1]}
        packageLineages={["single-use"]}
      />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-inapplicable-36")).toBeTruthy());
    expect(queryByTestId("voucher-picker-result-36")).toBeNull();
    expect(getByTestId("voucher-picker-inapplicable-36").textContent).toContain(
      "Doesn't cover every item",
    );
  });
  it.each([
    {
      name: "legacy ID-only package matching",
      packageIds: [1],
      packageLineages: undefined,
      voucher: voucher({ id: 60, code: "LEGACY_ID", applicable_packages: [1] }),
      result: true,
    },
    {
      name: "empty lineages with legacy ID-only matching",
      packageIds: [1],
      packageLineages: [],
      voucher: voucher({ id: 61, code: "EMPTY_LINEAGES", applicable_packages: [1] }),
      result: true,
    },
    {
      name: "mixed IDs and lineages",
      packageIds: [1, 2],
      packageLineages: [null, "day-pass"],
      voucher: voucher({
        id: 62,
        code: "MIXED_OK",
        applicable_packages: [1],
        applicable_package_lineages: ["day-pass"],
      }),
      result: true,
    },
    {
      name: "mixed cart with an uncovered package",
      packageIds: [1, 2],
      packageLineages: [null, "single-use"],
      voucher: voucher({
        id: 63,
        code: "MIXED_BAD",
        applicable_packages: [1],
        applicable_package_lineages: ["day-pass"],
      }),
      result: false,
    },
    {
      name: "null lineage without an allowed package ID",
      packageIds: [2],
      packageLineages: [null],
      voucher: voucher({
        id: 64,
        code: "NULL_LINEAGE",
        applicable_packages: [1],
        applicable_package_lineages: ["day-pass"],
      }),
      result: false,
    },
  ])("handles $name", async ({ packageIds, packageLineages, voucher: candidate, result }) => {
    mockPagedFetch([candidate]);
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker
        selected={null}
        onChange={vi.fn()}
        subtotal={1000}
        packageIds={packageIds}
        packageLineages={packageLineages}
      />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() =>
      expect(
        result
          ? getByTestId(`voucher-picker-result-${candidate.id}`)
          : getByTestId(`voucher-picker-inapplicable-${candidate.id}`),
      ).toBeTruthy(),
    );
    expect(queryByTestId(`voucher-picker-result-${candidate.id}`) !== null).toBe(result);
  });
  it("surfaces a load failure instead of rendering an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch,
    );
    const { getByTestId, queryByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));

    await waitFor(() =>
      expect(getByTestId("voucher-picker-popup").textContent).toContain("Permission denied"),
    );
    // The misleading "nothing here" copy must not stand in for a real failure.
    expect(queryByTestId("voucher-picker-popup")!.textContent).not.toContain(
      "No vouchers available.",
    );
  });

  it("surfaces a rejected voucher request", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))));
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() =>
      expect(getByTestId("voucher-picker-popup").textContent).toContain("network down"),
    );
  });
  it("surfaces a missing vouchers endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch,
    );
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={vi.fn()} subtotal={1000} packageIds={[]} />
    ));
    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() =>
      expect(getByTestId("voucher-picker-popup").textContent).toContain(
        "Vouchers module isn't available",
      ),
    );
  });
  it("reopening discards a pick that was staged but never confirmed", async () => {
    mockPagedFetch([voucher({ id: 40, code: "STAGED" }), voucher({ id: 41, code: "OTHER" })]);
    const onChange = vi.fn();
    const { getByTestId } = render(() => (
      <VoucherPicker selected={null} onChange={onChange} subtotal={1000} packageIds={[]} />
    ));

    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-result-40")).toBeTruthy());
    fireEvent.click(getByTestId("voucher-picker-result-40"));
    fireEvent.click(getByTestId("voucher-picker-cancel"));

    fireEvent.click(getByTestId("voucher-picker-trigger"));
    await waitFor(() => expect(getByTestId("voucher-picker-result-40")).toBeTruthy());
    expect(getByTestId("voucher-picker-draft-summary").textContent).toContain("No voucher selected");
    expect(onChange).not.toHaveBeenCalled();
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
