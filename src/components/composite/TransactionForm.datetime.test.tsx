// The date field is a date-only picker by default; supplying `setTime` turns it
// into one native date-and-time input.
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import TransactionForm, { type TransactionFormProps } from "./TransactionForm";

function baseProps(overrides: Partial<TransactionFormProps> = {}): TransactionFormProps {
  const noop = vi.fn();
  return {
    error: "",
    saving: false,
    category: "expense",
    setCategory: noop,
    subcategory: "",
    setSubcategory: noop,
    sourceAccount: "",
    setSourceAccount: noop,
    destAccount: "",
    setDestAccount: noop,
    amount: "",
    setAmount: noop,
    description: "",
    setDescription: noop,
    notes: "",
    setNotes: noop,
    date: "2026-09-10",
    setDate: noop,
    isPrivate: false,
    setIsPrivate: noop,
    sharedWith: [],
    setSharedWith: noop,
    sharedRoleCodes: [],
    setSharedRoleCodes: noop,
    backdateReason: "",
    setBackdateReason: noop,
    payee: "",
    setPayee: noop,
    payeeId: null,
    setPayeeId: noop,
    refNumber: "",
    setRefNumber: noop,
    taxType: "vat_inclusive",
    setTaxType: noop,
    hasEwt: false,
    setHasEwt: noop,
    ewtRate: "",
    setEwtRate: noop,
    payableKind: "",
    setPayableKind: noop,
    dueDate: "",
    setDueDate: noop,
    chequeNumber: "",
    setChequeNumber: noop,
    pdcStatus: "",
    setPdcStatus: noop,
    transferFeeEnabled: false,
    setTransferFeeEnabled: noop,
    transferFeeAmount: "",
    setTransferFeeAmount: noop,
    allowTransferFee: false,
    pendingFiles: [],
    setPendingFiles: noop,
    accounts: [],
    orgMembers: [],
    shareableRoles: [],
    isAdmin: true,
    canShare: false,
    isBackdated: false,
    saleItems: [],
    setSaleItems: noop,
    saleClient: null,
    setSaleClient: noop,
    saleVoucher: null,
    setSaleVoucher: noop,
    saleManualDiscount: "",
    setSaleManualDiscount: noop,
    onSubmit: noop,
    submitLabel: "Save",
    ...overrides,
  };
}

describe("TransactionForm date and time", () => {
  it("keeps the date-only picker when no time setter is supplied", () => {
    const { queryByTestId, getByText } = render(() => <TransactionForm {...baseProps()} />);
    expect(queryByTestId("transactions-form-datetime")).toBeNull();
    expect(getByText("Date *")).toBeTruthy();
  });

  it("shows one date-and-time input holding both values", () => {
    const { getByTestId, getByText } = render(() => (
      <TransactionForm {...baseProps({ time: "09:30:15", setTime: vi.fn() })} />
    ));
    const input = getByTestId("transactions-form-datetime") as HTMLInputElement;
    expect(input.type).toBe("datetime-local");
    expect(input.value).toBe("2026-09-10T09:30");
    expect(getByText("Date & time *")).toBeTruthy();
  });

  it("splits an edit into the date and the time", () => {
    const setDate = vi.fn();
    const setTime = vi.fn();
    const { getByTestId } = render(() => (
      <TransactionForm {...baseProps({ time: "09:30", setDate, setTime })} />
    ));
    const input = getByTestId("transactions-form-datetime") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "2026-09-11T18:45" } });
    expect(setDate).toHaveBeenCalledWith("2026-09-11");
    expect(setTime).toHaveBeenCalledWith("18:45");
  });

  it("ignores a cleared value instead of wiping the date", () => {
    const setDate = vi.fn();
    const setTime = vi.fn();
    const { getByTestId } = render(() => (
      <TransactionForm {...baseProps({ time: "09:30", setDate, setTime })} />
    ));
    fireEvent.input(getByTestId("transactions-form-datetime"), { target: { value: "" } });
    expect(setDate).not.toHaveBeenCalled();
    expect(setTime).not.toHaveBeenCalled();
  });

  it("locks the field and says why for non-admins", () => {
    const { getByTestId, getByText } = render(() => (
      <TransactionForm {...baseProps({ time: "09:30", setTime: vi.fn(), isAdmin: false })} />
    ));
    expect((getByTestId("transactions-form-datetime") as HTMLInputElement).disabled).toBe(true);
    expect(getByText("Only admins can change the date and time")).toBeTruthy();
  });
});
