import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import DatePicker, { type DateRangeValue } from "./DatePicker";

// DatePicker is the shared calendar popover used by every plugin's date input
// and by DataTable's date filter. The key behaviors: renders a trigger button
// labeled with the selected date (or placeholder), opens a calendar popover on
// click, and calls onChange when a day is selected. The dedup rule: plugin UI
// tests must NOT re-assert "calendar opens on click" or "selecting a day calls
// onChange" — those are owned here.

describe("DatePicker", () => {
  it("renders trigger with placeholder when no value is selected", () => {
    render(() => <DatePicker value={null} onChange={() => {}} />);
    expect(screen.getByText("Pick date")).toBeTruthy();
  });

  it("renders trigger with the selected date", () => {
    // Use a date far from today so formatDateDisplay renders "Jun 15" (not "Today")
    render(() => <DatePicker value="2026-06-15" onChange={() => {}} />);
    expect(screen.getByText("Jun 15")).toBeTruthy();
  });

  it("opens calendar popover on trigger click", async () => {
    render(() => <DatePicker value={null} onChange={() => {}} />);
    const trigger = screen.getByText("Pick date");
    await fireEvent.click(trigger);
    // Calendar grid should appear with day-of-week headers
    expect(screen.getByText("Su")).toBeTruthy();
    expect(screen.getByText("Mo")).toBeTruthy();
  });

  it("calls onChange when a day is clicked", async () => {
    const onChange = vi.fn();
    render(() => <DatePicker value="2026-06-15" onChange={onChange} />);
    // Open the popover
    await fireEvent.click(screen.getByText("Jun 15"));
    // Find and click a day (20 is visible in the June 2026 grid)
    const day20 = screen.getByText("20", { exact: true });
    await fireEvent.click(day20);
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("2026-06-20");
  });

  it("renders disabled trigger when disabled prop is true", () => {
    render(() => <DatePicker value={null} onChange={() => {}} disabled />);
    const trigger = screen.getByText("Pick date").closest("button")!;
    expect(trigger.disabled).toBe(true);
  });

  // Regression: a completed selection must close the popover, or the
  // top-layer-promoted panel keeps intercepting clicks meant for whatever's
  // underneath (e.g. a modal's submit button) after the user is done with it.
  it("closes the popover and refocuses the trigger after a day is clicked", async () => {
    const onChange = vi.fn();
    render(() => <DatePicker value="2026-06-15" onChange={onChange} />);
    const trigger = screen.getByText("Jun 15").closest("button")!;
    await fireEvent.click(trigger);
    expect(screen.getByTestId("datepicker-popover")).toBeTruthy();

    const day20 = screen.getByText("20", { exact: true });
    await fireEvent.click(day20);

    expect(onChange).toHaveBeenCalledWith("2026-06-20");
    expect(screen.queryByTestId("datepicker-popover")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes the popover after a quick-pick button is clicked", async () => {
    const onChange = vi.fn();
    render(() => <DatePicker value={null} onChange={onChange} />);
    await fireEvent.click(screen.getByText("Pick date"));
    expect(screen.getByTestId("datepicker-popover")).toBeTruthy();

    await fireEvent.click(screen.getByText("Yesterday"));

    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("datepicker-popover")).toBeNull();
  });

  it("keeps the popover open after the first pick in active range mode", async () => {
    const [range, setRange] = createSignal<DateRangeValue>({ start: null, end: null });
    render(() => <DatePicker range value={range()} onChange={setRange} />);
    await fireEvent.click(screen.getByText("Pick date"));
    // Range mode needs two clicks (start, then end); turning the toggle on
    // is what puts the calendar into that two-click mode.
    await fireEvent.click(screen.getByTestId("datepicker-end-date-toggle"));

    const day20 = screen.getByText("20", { exact: true });
    await fireEvent.click(day20);

    // Only one bound is set so far — the popover must stay open for the second pick.
    expect(screen.getByTestId("datepicker-popover")).toBeTruthy();
  });

  it("closes the popover after a range quick-pick button (atomic, both bounds set)", async () => {
    const [range, setRange] = createSignal<DateRangeValue>({ start: null, end: null });
    render(() => <DatePicker range value={range()} onChange={setRange} />);
    await fireEvent.click(screen.getByText("Pick date"));
    expect(screen.getByTestId("datepicker-popover")).toBeTruthy();

    await fireEvent.click(screen.getByText("Yesterday"));

    expect(range().start).toBe(range().end);
    expect(screen.queryByTestId("datepicker-popover")).toBeNull();
  });
});
