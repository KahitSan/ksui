// U7 — FlowRunner component tests: renders each node kind, calls advance with the
// node's input, handles a terminal node + an error.
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import FlowRunner from "./FlowRunner";
import type { FlowNode } from "../../utils/flow";

const terminal: FlowNode = { kind: "terminal", id: "end", message: "Done" };

describe("FlowRunner", () => {
  it("renders a form and calls advance with the form input on submit", async () => {
    const advance = vi.fn(async () => terminal);
    const onComplete = vi.fn();
    const { getByTestId } = render(() => (
      <FlowRunner
        testId="fr"
        initialNode={{
          kind: "form",
          id: "n1",
          title: "Pay",
          fields: [{ key: "amount", label: "Amount", type: "number", required: true }],
        }}
        advance={advance}
        state={{ token: "abc" }}
        onComplete={onComplete}
      />
    ));
    fireEvent.input(getByTestId("fr-field-amount"), { target: { value: "50" } });
    fireEvent.click(getByTestId("fr-submit"));
    await waitFor(() => expect(advance).toHaveBeenCalledWith({ token: "abc" }, { amount: "50" }));
    await waitFor(() => expect(getByTestId("fr-terminal")).toBeTruthy());
    expect(onComplete).toHaveBeenCalled();
  });

  it("blocks submit while a required field is empty", () => {
    const advance = vi.fn(async () => terminal);
    const { getByTestId } = render(() => (
      <FlowRunner
        testId="fr"
        initialNode={{
          kind: "form",
          id: "n1",
          fields: [{ key: "amount", label: "Amount", required: true }],
        }}
        advance={advance}
      />
    ));
    fireEvent.click(getByTestId("fr-submit"));
    expect(advance).not.toHaveBeenCalled();
  });

  it("renders a choice and submits the picked value", async () => {
    const advance = vi.fn(async () => terminal);
    const { getByTestId } = render(() => (
      <FlowRunner
        testId="fr"
        initialNode={{
          kind: "choice",
          id: "c1",
          options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
        }}
        advance={advance}
      />
    ));
    fireEvent.click(getByTestId("fr-choice-yes"));
    await waitFor(() => expect(advance).toHaveBeenCalledWith(undefined, { value: "yes" }));
  });

  it("renders a display node and continues with null input", async () => {
    const advance = vi.fn(async () => terminal);
    const { getByTestId } = render(() => (
      <FlowRunner
        testId="fr"
        initialNode={{ kind: "display", id: "d1", body: "Review this" }}
        advance={advance}
      />
    ));
    expect(getByTestId("fr-display").textContent).toContain("Review this");
    fireEvent.click(getByTestId("fr-continue"));
    await waitFor(() => expect(advance).toHaveBeenCalledWith(undefined, null));
  });

  it("renders a message node and acks", async () => {
    const advance = vi.fn(async () => terminal);
    const { getByTestId } = render(() => (
      <FlowRunner
        testId="fr"
        initialNode={{ kind: "message", id: "m1", text: "Heads up", tone: "info" }}
        advance={advance}
      />
    ));
    expect(getByTestId("fr-message").textContent).toContain("Heads up");
    fireEvent.click(getByTestId("fr-ack"));
    await waitFor(() => expect(advance).toHaveBeenCalled());
  });

  it("surfaces an error when advance rejects, without inventing the next node", async () => {
    const advance = vi.fn(async () => {
      throw new Error("server said no");
    });
    const { getByTestId, queryByTestId } = render(() => (
      <FlowRunner
        testId="fr"
        initialNode={{ kind: "choice", id: "c1", options: [{ value: "go", label: "Go" }] }}
        advance={advance}
      />
    ));
    fireEvent.click(getByTestId("fr-choice-go"));
    await waitFor(() => expect(getByTestId("fr-error").textContent).toContain("server said no"));
    // still on the choice node — the client never invents a next node
    expect(queryByTestId("fr-choice")).toBeTruthy();
  });

  it("takes the cancel path on a cancelable form", () => {
    const onCancel = vi.fn();
    const { getByTestId } = render(() => (
      <FlowRunner
        testId="fr"
        initialNode={{ kind: "form", id: "n1", cancelable: true, fields: [] }}
        advance={vi.fn(async () => terminal)}
        onCancel={onCancel}
      />
    ));
    fireEvent.click(getByTestId("fr-cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
});
