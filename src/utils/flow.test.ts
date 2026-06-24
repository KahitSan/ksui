// U7 — flow node-model pure helpers (no DOM).
import { describe, expect, it } from "vitest";
import {
  collectsInput,
  formNodeInput,
  isTerminal,
  missingRequired,
  type FlowFormNode,
} from "./flow";

const form: FlowFormNode = {
  kind: "form",
  id: "n1",
  fields: [
    { key: "amount", label: "Amount", type: "number", required: true },
    { key: "note", label: "Note", type: "text" },
  ],
};

describe("flow helpers", () => {
  it("isTerminal flags only terminal nodes", () => {
    expect(isTerminal({ kind: "terminal", id: "t" })).toBe(true);
    expect(isTerminal(form)).toBe(false);
  });

  it("collectsInput flags form + choice", () => {
    expect(collectsInput(form)).toBe(true);
    expect(collectsInput({ kind: "choice", id: "c", options: [] })).toBe(true);
    expect(collectsInput({ kind: "display", id: "d", body: "" })).toBe(false);
  });

  it("formNodeInput keeps declared fields, drops undefined", () => {
    expect(formNodeInput(form, { amount: 5, stray: "x" })).toEqual({ amount: 5 });
  });

  it("missingRequired reports empty required fields only", () => {
    expect(missingRequired(form, {})).toEqual(["amount"]);
    expect(missingRequired(form, { amount: 5 })).toEqual([]);
    expect(missingRequired(form, { amount: "" })).toEqual(["amount"]);
  });
});
