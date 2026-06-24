import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";
import BadgeSelect, { type BadgeSelectOption } from "./BadgeSelect";

// BadgeSelect is the generic, domain-free inline picker lifted from kserp's
// RoleBadgeSelect (U1). The caller injects options, the value↔label mapping,
// and (optionally) the badge tone; nothing here is role-specific. The popup
// renders into a Portal (document.body), so popup assertions use `screen`.

const OPTIONS: BadgeSelectOption[] = [
  { value: "admin", label: "Admin", description: "Full access" },
  { value: "member", label: "Member" },
];

describe("BadgeSelect", () => {
  it("renders the selected option's label on the trigger", () => {
    const { getByRole } = render(() => (
      <BadgeSelect value="admin" options={OPTIONS} onChange={() => {}} />
    ));
    expect(getByRole("button").textContent).toContain("Admin");
  });

  it("falls back to the raw value when no option matches", () => {
    const { getByRole } = render(() => (
      <BadgeSelect value="ghost" options={OPTIONS} onChange={() => {}} />
    ));
    expect(getByRole("button").textContent).toContain("ghost");
  });

  it("opens the popup and emits the chosen value on select", async () => {
    const onChange = vi.fn();
    const { getByRole } = render(() => (
      <BadgeSelect value="admin" options={OPTIONS} onChange={onChange} />
    ));
    fireEvent.click(getByRole("button"));
    const memberOpt = await screen.findByText("Member");
    fireEvent.click(memberOpt);
    expect(onChange).toHaveBeenCalledWith("member");
  });

  it("does not emit when re-selecting the current value", async () => {
    const onChange = vi.fn();
    const { getByRole } = render(() => (
      <BadgeSelect value="admin" options={OPTIONS} onChange={onChange} />
    ));
    fireEvent.click(getByRole("button"));
    // Wait for the popup, then click the option row for the active value.
    await screen.findByText("Member");
    const adminRows = screen.getAllByText("Admin");
    fireEvent.click(adminRows[adminRows.length - 1]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("applies the injected badgeClass to the trigger (DI tone)", () => {
    const { getByRole } = render(() => (
      <BadgeSelect
        value="admin"
        options={OPTIONS}
        onChange={() => {}}
        badgeClass={(v) => (v === "admin" ? "tone-special" : "tone-default")}
      />
    ));
    expect(getByRole("button").className).toContain("tone-special");
  });

  it("disables the trigger when disabled", () => {
    const { getByRole } = render(() => (
      <BadgeSelect value="admin" options={OPTIONS} disabled onChange={() => {}} />
    ));
    expect((getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("exposes listbox/option ARIA semantics when open", async () => {
    const { getByRole } = render(() => (
      <BadgeSelect value="admin" options={OPTIONS} onChange={() => {}} />
    ));
    const trigger = getByRole("button");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    // The active option advertises its selected state to assistive tech.
    const selected = screen.getAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true");
    expect(selected?.textContent).toContain("Admin");
  });
});
