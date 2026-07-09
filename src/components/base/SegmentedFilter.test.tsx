import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import SegmentedFilter, { type SegmentedFilterOption } from "./SegmentedFilter";

// Back-compat: bare-string options are still accepted alongside the object
// form, so callers frozen on the old shape don't need a migration.
const STRING_OPTIONS: SegmentedFilterOption[] = ["today", "week", "month"];

const OBJECT_OPTIONS: SegmentedFilterOption[] = [
  { value: "table", label: "Table" },
  { value: "calendar", label: "Calendar" },
];

const WITH_DISABLED: SegmentedFilterOption[] = [
  { value: "daily", label: "Per day" },
  { value: "hourly", label: "Per hour", disabled: true, disabledNote: "Unavailable for this staff type" },
  { value: "fixed", label: "Fixed period" },
];

describe("SegmentedFilter", () => {
  it("renders bare-string options capitalized (back-compat)", () => {
    const { getAllByRole } = render(() => (
      <SegmentedFilter options={STRING_OPTIONS} value="today" onChange={() => {}} />
    ));
    const radios = getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["today", "week", "month"]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
  });

  it("renders object options with an explicit label", () => {
    const { getAllByRole } = render(() => (
      <SegmentedFilter options={OBJECT_OPTIONS} value="table" onChange={() => {}} />
    ));
    const radios = getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Table", "Calendar"]);
  });

  it("emits the clicked value on an enabled segment", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(() => (
      <SegmentedFilter options={OBJECT_OPTIONS} value="table" onChange={onChange} />
    ));
    fireEvent.click(getAllByRole("radio")[1]);
    expect(onChange).toHaveBeenCalledWith("calendar");
  });

  it("no-ops a click on a disabled segment", () => {
    const onChange = vi.fn();
    const { getAllByRole } = render(() => (
      <SegmentedFilter options={WITH_DISABLED} value="daily" onChange={onChange} />
    ));
    fireEvent.click(getAllByRole("radio")[1]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("exposes aria-disabled and the disabledNote via title + sr-only text", () => {
    const { getAllByRole, getByText } = render(() => (
      <SegmentedFilter options={WITH_DISABLED} value="daily" onChange={() => {}} />
    ));
    const disabledRadio = getAllByRole("radio")[1];
    expect(disabledRadio.getAttribute("aria-disabled")).toBe("true");
    expect(disabledRadio.getAttribute("title")).toBe("Unavailable for this staff type");
    expect(getByText("Unavailable for this staff type").className).toContain("sr-only");
  });

  it("does not set aria-disabled on enabled segments", () => {
    const { getAllByRole } = render(() => (
      <SegmentedFilter options={WITH_DISABLED} value="daily" onChange={() => {}} />
    ));
    expect(getAllByRole("radio")[0].getAttribute("aria-disabled")).toBe("false");
  });

  it("pulls disabled segments out of tab order", () => {
    const { getAllByRole } = render(() => (
      <SegmentedFilter options={WITH_DISABLED} value="daily" onChange={() => {}} />
    ));
    expect(getAllByRole("radio")[1].getAttribute("tabindex")).toBe("-1");
  });

  it("ArrowRight skips a disabled segment and selects the next enabled one", () => {
    const onChange = vi.fn();
    const { container } = render(() => (
      <SegmentedFilter options={WITH_DISABLED} value="daily" onChange={onChange} />
    ));
    fireEvent.keyDown(container.querySelector('[role="radiogroup"]')!, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("fixed");
  });

  it("ArrowLeft wraps past a disabled segment to the previous enabled one", () => {
    const onChange = vi.fn();
    const { container } = render(() => (
      <SegmentedFilter options={WITH_DISABLED} value="daily" onChange={onChange} />
    ));
    fireEvent.keyDown(container.querySelector('[role="radiogroup"]')!, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("fixed");
  });

  it("End lands on the last enabled segment even if the last option is disabled", () => {
    const onChange = vi.fn();
    const trailingDisabled: SegmentedFilterOption[] = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
      { value: "c", label: "C", disabled: true },
    ];
    const { container } = render(() => (
      <SegmentedFilter options={trailingDisabled} value="a" onChange={onChange} />
    ));
    fireEvent.keyDown(container.querySelector('[role="radiogroup"]')!, { key: "End" });
    expect(onChange).toHaveBeenCalledWith("b");
  });
});
