import { createSignal } from "solid-js";
import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import MonthCalendar from "./MonthCalendar";

function renderCalendar(overrides: Partial<Parameters<typeof MonthCalendar>[0]> = {}) {
  const onMonthChange = vi.fn();
  render(() => (
    <MonthCalendar
      month="2026-09-19"
      today="2026-09-12"
      onMonthChange={onMonthChange}
      renderDay={({ date }) => <button type="button">Open {date}</button>}
      {...overrides}
    />
  ));
  return { onMonthChange };
}

describe("MonthCalendar", () => {
  it("renders labelled grid semantics and six seven-day rows", () => {
    renderCalendar();
    const section = screen.getByRole("region", { name: "September 2026" });
    const grid = within(section).getByRole("grid", { name: "September 2026" });
    expect(within(grid).getAllByRole("columnheader").map((node) => node.textContent)).toEqual([
      "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
    ]);
    expect(within(grid).getAllByRole("row")).toHaveLength(7);
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(42);
  });

  it("normalizes previous, next, and today changes to month starts", async () => {
    const { onMonthChange } = renderCalendar();
    await fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onMonthChange.mock.calls).toEqual([
      ["2026-08-01"],
      ["2026-10-01"],
      ["2026-09-01"],
    ]);
  });

  it("marks today and labels day cells with full dates", () => {
    renderCalendar();
    const today = screen.getByRole("gridcell", { name: "Saturday, September 12, 2026" });
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(within(today).getByText("Open 2026-09-12")).toBeTruthy();
  });

  it("hides outside cells and skips their render slots", () => {
    const renderDay = vi.fn(({ date }: { date: string }) => <span>{date}</span>);
    renderCalendar({ showOutsideDays: false, renderDay });
    expect(renderDay).toHaveBeenCalledTimes(30);
    expect(screen.queryByText("2026-08-30")).toBeNull();
    const hiddenCells = screen.getAllByRole("gridcell", { hidden: true }).filter((cell) => cell.getAttribute("aria-hidden") === "true");
    expect(hiddenCells).toHaveLength(12);
  });

  it("supports Monday-first localized headers and custom labels", () => {
    renderCalendar({
      weekStartsOn: 1,
      locale: "fr-FR",
      labels: { previousMonth: "Mois précédent", nextMonth: "Mois suivant", today: "Aujourd’hui" },
    });
    expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).toEqual([
      "lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim.",
    ]);
    expect(screen.getByRole("button", { name: "Mois précédent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Aujourd’hui" })).toBeTruthy();
  });

  it("supports controlled month updates", async () => {
    const [month, setMonth] = createSignal("2026-09-30");
    render(() => (
      <MonthCalendar
        month={month()}
        today="2026-09-12"
        onMonthChange={setMonth}
        renderDay={({ date }) => <span>{date}</span>}
      />
    ));
    await fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeTruthy();
  });

  it("passes week metadata and stable child rendering through renderWeek", () => {
    const weeks: string[] = [];
    renderCalendar({
      renderWeek: ({ weekIndex, days, children }) => {
        weeks.push(`${weekIndex}:${days[0].date}`);
        return <>{children()}</>;
      },
    });
    expect(weeks).toEqual([
      "0:2026-08-30", "1:2026-09-06", "2:2026-09-13",
      "3:2026-09-20", "4:2026-09-27", "5:2026-10-04",
    ]);
  });

  it("allows class overrides and hiding today button", () => {
    renderCalendar({ classes: { root: "custom-root", cell: "custom-cell" }, showTodayButton: false });
    expect(screen.getByRole("region").classList.contains("custom-root")).toBe(true);
    expect(screen.getAllByRole("gridcell")[0].classList.contains("custom-cell")).toBe(true);
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull();
  });
});
