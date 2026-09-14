import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import MultiSelectGroup from "./MultiSelectGroup";

const options = [
  { value: "sun", label: "Sun" },
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
];

describe("MultiSelectGroup", () => {
  it("adds and removes independent selections in option order", async () => {
    const [value, setValue] = createSignal<string[]>(["tue"]);
    render(() => <MultiSelectGroup ariaLabel="Repeat on" options={options} value={value()} onChange={setValue} />);
    await fireEvent.click(screen.getByRole("button", { name: "Mon" }));
    expect(value()).toEqual(["mon", "tue"]);
    await fireEvent.click(screen.getByRole("button", { name: "Tue" }));
    expect(value()).toEqual(["mon"]);
  });

  it("exposes pressed state and native keyboard activation", async () => {
    const onChange = vi.fn();
    render(() => <MultiSelectGroup ariaLabel="Days" options={options} value={["mon"]} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Mon" }).getAttribute("aria-pressed")).toBe("true");
    const sunday = screen.getByRole("button", { name: "Sun" });
    sunday.focus();
    await fireEvent.keyDown(sunday, { key: "Enter" });
    await fireEvent.click(sunday);
    expect(onChange).toHaveBeenCalledWith(["sun", "mon"]);
  });

  it("blocks disabled options", async () => {
    const onChange = vi.fn();
    render(() => <MultiSelectGroup ariaLabel="Days" options={[{ value: "sun", label: "Sun", disabled: true }]} value={[]} onChange={onChange} />);
    const button = screen.getByRole("button", { name: "Sun" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await fireEvent.click(button);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("MultiSelectGroup variants", () => {
  it("keeps the existing info selected treatment by default", () => {
    render(() => <MultiSelectGroup ariaLabel="Days" options={options} value={["mon"]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Mon" }).className).toContain("--ks-info");
  });

  it("uses the accent selected-state treatment when requested", () => {
    render(() => <MultiSelectGroup ariaLabel="Days" options={options} value={["mon"]} onChange={() => {}} variant="accent" />);
    const selected = screen.getByRole("button", { name: "Mon" });
    expect(selected.className).toContain("--ks-accent");
    expect(selected.className).not.toContain("--ks-info");
  });
});
