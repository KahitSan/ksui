import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import Pencil from "lucide-solid/icons/pencil";
import ActionMenu, { RowMenu } from "./ActionMenu";

const items = [
  { id: "open", label: "Open", icon: Pencil },
  { id: "disabled", label: "Unavailable", disabled: true },
  { id: "remove", label: "Remove", danger: true, separatorBefore: true },
];

async function flushMenu() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("ActionMenu", () => {
  it("opens an accessible menu, focuses the first enabled item, and selects", async () => {
    const onSelect = vi.fn();
    render(() => <ActionMenu label="Row actions" items={items} onSelect={onSelect} testId="row-menu" />);
    const trigger = screen.getByTestId("row-menu");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    await fireEvent.click(trigger);
    await flushMenu();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu", { name: "Row actions" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Open" }));
    expect(screen.getByRole("menuitem", { name: "Open" }).querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    await fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    expect(onSelect).toHaveBeenCalledWith("open");
    expect(screen.queryByRole("menu")).toBeNull();
    await flushMenu();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps focus moved by selection callback", async () => {
    render(() => (
      <div>
        <ActionMenu
          label="Actions"
          items={items}
          onSelect={() => screen.getByRole("button", { name: "Destination" }).focus()}
        />
        <button type="button">Destination</button>
      </div>
    ));
    await fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    await flushMenu();
    await fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    await flushMenu();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Destination" }));
  });

  it("skips disabled items during arrow navigation and restores trigger focus on Escape", async () => {
    render(() => <ActionMenu label="Actions" items={items} onSelect={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    await fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await flushMenu();
    const open = screen.getByRole("menuitem", { name: "Open" });
    const remove = screen.getByRole("menuitem", { name: "Remove" });
    expect(document.activeElement).toBe(open);
    await fireEvent.keyDown(open, { key: "ArrowDown" });
    expect(document.activeElement).toBe(remove);
    expect((screen.getByRole("menuitem", { name: "Unavailable" }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.keyDown(remove, { key: "Escape" });
    await flushMenu();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on outside press and exposes RowMenu as the same reusable component", async () => {
    render(() => (
      <div>
        <RowMenu label="More actions" items={items} onSelect={() => {}} />
        <button type="button">Outside</button>
      </div>
    ));
    await fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    await flushMenu();
    expect(screen.getByRole("menu")).toBeTruthy();
    await fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
