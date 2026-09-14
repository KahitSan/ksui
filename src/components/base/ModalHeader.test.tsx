import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import ModalHeader from "./ModalHeader";

describe("ModalHeader", () => {
  it("renders title, subtitle, and an accessible close control", async () => {
    const onClose = vi.fn();
    render(() => <ModalHeader title="Edit schedule" subtitle="Future entries only" onClose={onClose} />);
    expect(screen.getByRole("heading", { name: "Edit schedule", level: 2 })).toBeTruthy();
    expect(screen.getByText("Future entries only")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders JSX slots through owner-safe functions", () => {
    render(() => (
      <ModalHeader
        title={() => <label><span>Schedule name</span><input aria-label="Schedule name" /></label>}
        subtitle={() => <strong>Recurring monthly</strong>}
        onClose={() => {}}
      />
    ));
    expect(screen.getByRole("textbox", { name: "Schedule name" })).toBeTruthy();
    expect(screen.getByText("Recurring monthly")).toBeTruthy();
  });

  it("accepts custom title id, close label, and classes", () => {
    const { container } = render(() => (
      <ModalHeader title="Details" titleId="details-title" closeLabel="Close details" class="custom-header" onClose={() => {}} />
    ));
    expect(screen.getByRole("heading").id).toBe("details-title");
    expect(screen.getByRole("button", { name: "Close details" })).toBeTruthy();
    expect(container.querySelector("header")?.classList.contains("custom-header")).toBe(true);
  });
});
