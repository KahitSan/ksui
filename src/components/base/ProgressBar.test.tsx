import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import ProgressBar from "./ProgressBar";

describe("ProgressBar", () => {
  it("preserves the existing full-height default variant", () => {
    const { container } = render(() => <ProgressBar progress={35} label="Imported" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-8");
    expect(root.getAttribute("role")).toBeNull();
    expect(root.textContent).toContain("35%");
  });

  it("renders the compact labeled variant with progress semantics", () => {
    render(() => <ProgressBar variant="compact" progress={42.4} label="2 / 5 paid" />);
    const progress = screen.getByRole("progressbar", { name: "2 / 5 paid" });
    expect(progress.getAttribute("aria-valuenow")).toBe("42");
    expect(progress.textContent).toContain("2 / 5 paid");
    expect(progress.textContent).toContain("42%");
    expect(progress.querySelector<HTMLElement>('[style*="width"]')?.style.width).toBe("42%");
  });

  it("clamps compact progress and supports a custom right label and color", () => {
    render(() => <ProgressBar variant="compact" progress={140} label="Complete" rightLabel="Done" color="green" />);
    const progress = screen.getByRole("progressbar", { name: "Complete" });
    expect(progress.getAttribute("aria-valuenow")).toBe("100");
    expect(progress.textContent).toContain("Done");
    const fill = progress.querySelector<HTMLElement>('[style*="width"]')!;
    expect(fill.style.width).toBe("100%");
    expect(fill.style.backgroundColor).toContain("--ks-success");
  });
});
