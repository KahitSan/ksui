import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import DatePicker from "./DatePicker";

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
});
