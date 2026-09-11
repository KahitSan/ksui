import { describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import FormField from "./FormField";

describe("FormField", () => {
  it("associates optional id with its label", () => {
    const { getByLabelText } = render(() => (
      <FormField label="Amount" id="amount-field">
        <input id="amount-field" />
      </FormField>
    ));
    expect(getByLabelText("Amount").id).toBe("amount-field");
  });

  it("preserves unlabeled-control compatibility when id is omitted", () => {
    const { getByText } = render(() => (
      <FormField label="Notes">
        <textarea />
      </FormField>
    ));
    expect(getByText("Notes")).toBeTruthy();
  });
});
