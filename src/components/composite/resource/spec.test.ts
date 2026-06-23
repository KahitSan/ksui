// Unit tests for the spec-driven UI runtime's PURE helpers (no DOM). They pin
// the request/validation/form behavior that ResourcePage relies on.
import { describe, it, expect } from "vitest";
import {
  buildListQuery,
  emptyFormValues,
  endpoints,
  formToBody,
  initialFilterState,
  rowToFormValues,
  selectDefault,
  cleanLabel,
  validateForm,
  resolveForeignValue,
  type ResourceUiSpec,
  type UiFieldSelect,
  type UiColumn,
} from "./spec";

// A self-contained fixture exercising every helper branch (segmented + select
// filters, text/textarea/select fields, trim/trimOrNull transforms).
const spec: ResourceUiSpec = {
  basePath: "/api/things",
  title: "Things",
  permissions: { view: "things.view", edit: ["things.create", "things.edit"], delete: "things.delete" },
  softDeleteField: "is_active",
  testIdPrefix: "things",
  columns: [{ key: "name", title: "Name", render: { type: "title" } }],
  fields: [
    { key: "name", label: "Name *", type: "text", required: true, transform: "trim" },
    { key: "kind", label: "Kind", type: "select", default: "vendor", options: [
      { value: "vendor", label: "Vendor" },
      { value: "customer", label: "Customer" },
    ] },
    { key: "category", label: "Category", type: "text", transform: "trimOrNull" },
    { key: "notes", label: "Notes", type: "textarea", transform: "trimOrNull" },
  ],
  filters: [
    { type: "segmented", param: "status", options: ["active", "archived", "all"], default: "active", testIdPrefix: "things-status" },
    { type: "select", param: "kind", default: "", options: [
      { value: "", label: "All kinds" },
      { value: "vendor", label: "Vendors" },
    ] },
  ],
  detail: [{ label: "Name", value: { type: "field", key: "name" } }],
  labels: {
    add: "Add Thing", createTitle: "New Thing", createSubmit: "Create", editTitle: "Edit Thing",
    editSubmit: "Save", titleField: "name", searchPlaceholder: "Search…", empty: "None yet",
    noResults: "No matches", createErrorFallback: "Failed to create", updateErrorFallback: "Failed to update",
    networkError: "Network error", archiveTitle: "Archive?", archiveMessage: "Hidden.", archiveConfirm: "Archive",
  },
};

const baseParams = { page: 1, limit: 25, search: "", sortBy: null, sortDir: "asc" };

describe("endpoints", () => {
  it("derives CRUD paths from basePath", () => {
    const ep = endpoints(spec);
    expect(ep.list).toBe("/api/things");
    expect(ep.one(7)).toBe("/api/things/7");
    expect(ep.restore(7)).toBe("/api/things/7/restore");
  });
});

describe("buildListQuery", () => {
  it("always carries paging/search/sort + segmented filter; omits empty select", () => {
    const q = buildListQuery(spec, baseParams, initialFilterState(spec));
    expect(q.get("page")).toBe("1");
    expect(q.get("sortBy")).toBe("");
    expect(q.get("status")).toBe("active");
    expect(q.has("kind")).toBe(false);
  });
  it("sends a select filter once it has a value", () => {
    const q = buildListQuery(spec, baseParams, { status: "archived", kind: "vendor" });
    expect(q.get("status")).toBe("archived");
    expect(q.get("kind")).toBe("vendor");
  });
});

describe("form values", () => {
  it("empty form: '' for text/textarea, default option for select", () => {
    expect(emptyFormValues(spec)).toEqual({ name: "", kind: "vendor", category: "", notes: "" });
  });
  it("selectDefault falls back to the first option", () => {
    const f: UiFieldSelect = { type: "select", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] };
    expect(selectDefault(f)).toBe("a");
  });
  it("rowToFormValues prefills from a row, null → ''", () => {
    expect(rowToFormValues(spec, { id: 3, name: "X", kind: "vendor", category: null, notes: "hi" }))
      .toEqual({ name: "X", kind: "vendor", category: "", notes: "hi" });
  });
});

describe("validateForm", () => {
  it("flags the first required-but-empty field with a clean label", () => {
    expect(validateForm(spec, { name: " ", kind: "vendor", category: "", notes: "" })).toBe("Name is required");
  });
  it("passes when required fields are filled", () => {
    expect(validateForm(spec, { name: "X", kind: "vendor", category: "", notes: "" })).toBeNull();
  });
  it("flags a required select left on an empty placeholder option", () => {
    const s = { fields: [{ key: "kind", label: "Kind *", type: "select", required: true,
      options: [{ value: "", label: "Choose…" }, { value: "a", label: "A" }] }] } as unknown as ResourceUiSpec;
    expect(validateForm(s, { kind: "" })).toBe("Kind is required");
    expect(validateForm(s, { kind: "a" })).toBeNull();
  });
  it("cleanLabel strips a trailing required marker", () => {
    expect(cleanLabel("Name *")).toBe("Name");
    expect(cleanLabel("Notes")).toBe("Notes");
  });
});

describe("formToBody", () => {
  it("trims required text, nulls empty optional, passes select raw", () => {
    expect(formToBody(spec, { name: "  X  ", kind: "customer", category: "   ", notes: "  n  " }))
      .toEqual({ name: "X", kind: "customer", category: null, notes: "n" });
  });
});

describe("resolveForeignValue (U4 foreign-data contract)", () => {
  const plain: UiColumn = { key: "name", title: "Name", render: { type: "text" } };
  const foreign: UiColumn = {
    key: "balance",
    title: "Balance",
    render: { type: "text" },
    foreign: { source: { peer: "financial-accounts", field: "balance" }, onError: "dash" },
  };
  const row = { id: 1, name: "Acme", balance: "ignored-own-value" };

  it("reads the own row value for a plain column", () => {
    expect(resolveForeignValue(plain, row)).toBe("Acme");
  });
  it("THROWS for a foreign column with no resolver wired (throw-on-unwired guard)", () => {
    expect(() => resolveForeignValue(foreign, row)).toThrow(/foreign source.*no ForeignResolver/);
  });
  it("delegates to a wired resolver for a foreign column", () => {
    const resolver = (s: { peer: string; field: string }) => `${s.peer}:${s.field}=42`;
    expect(resolveForeignValue(foreign, row, resolver)).toBe("financial-accounts:balance=42");
  });
});
