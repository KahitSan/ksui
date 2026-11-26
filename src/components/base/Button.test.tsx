import { describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import Button from "./Button";

describe("Button defaults", () => {
  // Wrappers forward optional props; an explicit undefined must keep the default.
  it("keeps the default element when `as` is forwarded as undefined", () => {
    const { container } = render(() => <Button as={undefined}>Go</Button>);
    expect(container.querySelector("button")).not.toBeNull();
  });

  it("keeps the left icon position when forwarded as undefined", () => {
    const Icon = () => <svg data-testid="icon" />;
    const { container } = render(() => (
      <Button icon={Icon} iconPosition={undefined}>
        Go
      </Button>
    ));
    const html = container.querySelector("button")!.innerHTML;
    expect(html.indexOf("<svg")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("Go"));
  });
});
