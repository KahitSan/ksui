// Opt-in tax-ID capture next to the payee picker: shows the picked payee's TIN
// and address, offers inputs when they are missing, and warns when withholding
// is on but no TIN is known.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import TransactionForm, { type TransactionFormProps } from "./TransactionForm";
import { isValidTin } from "./payee-tin";

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
    payee: "Acme Hardware",
    setPayee: noop,
    payeeId: 7,
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

const tinProps = (extra: Partial<TransactionFormProps> = {}) =>
  baseProps({
    payeeTin: "",
    setPayeeTin: vi.fn(),
    payeeAddress: "",
    setPayeeAddress: vi.fn(),
    ...extra,
  });

function mockPayee(record: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(record), { status: 200 })),
  );
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("isValidTin", () => {
  it("accepts 9 or 12 digits with or without dashes", () => {
    expect(isValidTin("123456789")).toBe(true);
    expect(isValidTin("123-456-789")).toBe(true);
    expect(isValidTin("123-456-789-000")).toBe(true);
    expect(isValidTin("123456789000")).toBe(true);
  });
  it("rejects other lengths and non-digits", () => {
    expect(isValidTin("12345678")).toBe(false);
    expect(isValidTin("1234567890")).toBe(false);
    expect(isValidTin("12a-456-789")).toBe(false);
  });
  it("treats blank as valid because the field is optional", () => {
    expect(isValidTin("")).toBe(true);
    expect(isValidTin("   ")).toBe(true);
  });
});

describe("TransactionForm payee tax ID", () => {
  it("renders nothing extra when the host does not opt in", async () => {
    mockPayee({ id: 7, name: "Acme Hardware", kind: "vendor", tin: null, address: null });
    const { queryByTestId } = render(() => <TransactionForm {...baseProps()} />);
    await Promise.resolve();
    expect(queryByTestId("form-payee-tin-input")).toBeNull();
    expect(queryByTestId("form-payee-tin-readonly")).toBeNull();
  });

  it("shows the saved TIN and address read-only and offers no input", async () => {
    mockPayee({
      id: 7,
      name: "Acme Hardware",
      kind: "vendor",
      tin: "123-456-789-00000",
      address: "1 Main St",
    });
    const { findByTestId, queryByTestId } = render(() => <TransactionForm {...tinProps()} />);
    const line = await findByTestId("form-payee-tin-readonly");
    expect(line.textContent).toContain("123-456-789-00000");
    expect(line.textContent).toContain("1 Main St");
    expect(queryByTestId("form-payee-tin-input")).toBeNull();
    expect(queryByTestId("form-payee-address-input")).toBeNull();
  });

  it("offers TIN and address inputs when the payee has neither", async () => {
    mockPayee({ id: 7, name: "Acme Hardware", kind: "vendor", tin: null, address: null });
    const setPayeeTin = vi.fn();
    const setPayeeAddress = vi.fn();
    const { findByTestId } = render(() => (
      <TransactionForm {...tinProps({ setPayeeTin, setPayeeAddress })} />
    ));
    const tin = (await findByTestId("form-payee-tin-input")) as HTMLInputElement;
    fireEvent.input(tin, { target: { value: "123-456-789" } });
    expect(setPayeeTin).toHaveBeenCalledWith("123-456-789");
    const addr = (await findByTestId("form-payee-address-input")) as HTMLInputElement;
    fireEvent.input(addr, { target: { value: "2 Side St" } });
    expect(setPayeeAddress).toHaveBeenCalledWith("2 Side St");
  });

  it("asks only for the address when the TIN is already saved", async () => {
    mockPayee({ id: 7, name: "Acme Hardware", kind: "vendor", tin: "123456789", address: "" });
    const { findByTestId, queryByTestId } = render(() => <TransactionForm {...tinProps()} />);
    await findByTestId("form-payee-address-input");
    expect(queryByTestId("form-payee-tin-input")).toBeNull();
  });

  it("flags a malformed TIN", async () => {
    mockPayee({ id: 7, name: "Acme Hardware", kind: "vendor", tin: null, address: null });
    const { findByTestId, queryByTestId } = render(() => (
      <TransactionForm {...tinProps({ payeeTin: "12-34" })} />
    ));
    await findByTestId("form-payee-tin-input");
    expect(queryByTestId("form-payee-tin-error")).toBeTruthy();
  });

  it("does not flag a valid TIN", async () => {
    mockPayee({ id: 7, name: "Acme Hardware", kind: "vendor", tin: null, address: null });
    const { findByTestId, queryByTestId } = render(() => (
      <TransactionForm {...tinProps({ payeeTin: "123-456-789" })} />
    ));
    await findByTestId("form-payee-tin-input");
    expect(queryByTestId("form-payee-tin-error")).toBeNull();
  });

  it("warns, without blocking, when withholding is on and no TIN is known", async () => {
    mockPayee({ id: 7, name: "Acme Hardware", kind: "vendor", tin: null, address: null });
    const { findByTestId } = render(() => <TransactionForm {...tinProps({ hasEwt: true })} />);
    const warn = await findByTestId("form-payee-tin-ewt-warning");
    expect(warn.textContent).toMatch(/TIN/);
  });

  it("drops the warning once a TIN is typed or already saved", async () => {
    mockPayee({ id: 7, name: "Acme Hardware", kind: "vendor", tin: null, address: null });
    const typed = render(() => (
      <TransactionForm {...tinProps({ hasEwt: true, payeeTin: "123-456-789" })} />
    ));
    await typed.findByTestId("form-payee-tin-input");
    expect(typed.queryByTestId("form-payee-tin-ewt-warning")).toBeNull();
    typed.unmount();

    mockPayee({ id: 7, name: "Acme Hardware", kind: "vendor", tin: "123456789", address: "x" });
    const saved = render(() => <TransactionForm {...tinProps({ hasEwt: true })} />);
    await saved.findByTestId("form-payee-tin-readonly");
    expect(saved.queryByTestId("form-payee-tin-ewt-warning")).toBeNull();
  });

  it("shows nothing before a payee is chosen", async () => {
    mockPayee({});
    const { queryByTestId } = render(() => (
      <TransactionForm {...tinProps({ payee: "", payeeId: null, hasEwt: true })} />
    ));
    await waitFor(() => expect(queryByTestId("form-payee-tin-input")).toBeNull());
    expect(queryByTestId("form-payee-tin-ewt-warning")).toBeNull();
  });

  it("stays out of sales", async () => {
    mockPayee({ id: 7, name: "Acme Hardware", kind: "customer", tin: null, address: null });
    const { queryByTestId } = render(() => <TransactionForm {...tinProps({ category: "sale" })} />);
    await Promise.resolve();
    expect(queryByTestId("form-payee-tin-input")).toBeNull();
  });
});
