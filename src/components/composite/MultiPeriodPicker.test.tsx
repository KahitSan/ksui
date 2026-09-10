import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import MultiPeriodPicker from "./MultiPeriodPicker";

const NOW = new Date("2026-09-10T12:00:00Z");

describe("MultiPeriodPicker", () => {
  it("supports disjoint tokens and removes them independently", async () => {
    const onSelectedChange = vi.fn();
    const view = render(() => <MultiPeriodPicker granularity="month" selected={["2026-01", "2026-03"]} onGranularityChange={() => {}} onSelectedChange={onSelectedChange} now={NOW} />);
    await fireEvent.click(view.getByRole("button", { name: "2 months" }));
    expect(screen.getByRole("button", { name: "Remove January 2026" })).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Remove January 2026" }));
    expect(onSelectedChange).toHaveBeenCalledWith(["2026-03"]);
  });

  it("changes granularity and emits selected token", async () => {
    const onGranularityChange = vi.fn();
    const onSelectedChange = vi.fn();
    const [granularity, setGranularity] = createSignal<"day" | "week" | "month" | "year">("month");
    const view = render(() => <MultiPeriodPicker granularity={granularity()} selected={[]} onGranularityChange={(value) => { onGranularityChange(value); setGranularity(value); }} onSelectedChange={onSelectedChange} now={NOW} />);
    await fireEvent.click(view.getByRole("tab", { name: "Year" }));
    expect(onGranularityChange).toHaveBeenCalledWith("year");
    await fireEvent.click(view.getByRole("button", { name: "Pick periods" }));
    await fireEvent.click(screen.getByRole("button", { name: "2026" }));
    expect(onSelectedChange).toHaveBeenCalledWith(["2026"]);
  });

  it("uses injected labels and token renderer", async () => {
    const view = render(() => <MultiPeriodPicker granularity="year" selected={[]} onGranularityChange={() => {}} onSelectedChange={() => {}} now={NOW} labels={{ year: "Fiscal year", pick: "Choose periods" }} renderToken={(token) => <strong data-testid={`token-${token.token}`}>FY {token.label}</strong>} />);
    expect(view.getByRole("tab", { name: "Fiscal year" })).toBeTruthy();
    await fireEvent.click(view.getByRole("button", { name: "Choose periods" }));
    expect(screen.getByTestId("token-2026").textContent).toBe("FY 2026");
  });
});
