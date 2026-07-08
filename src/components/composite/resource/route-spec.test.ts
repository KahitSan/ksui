// Unit tests for the RouteSpec builder layer + its lowering. They pin the
// contract that a built RouteSpec lowers to the EXACT ResourceUiSpec a
// hand-authored spec would produce, and that unrepresentable config fails
// loudly instead of being silently dropped.
import { describe, it, expect } from "vitest";
import { Cell, action, col, defineRoute, setting, table } from "./route-spec";
import { defineForm, field, fieldToUiField } from "./form-spec";
import { routeToResourceSpec } from "./route-adapter";
import type { ResourceUiSpec } from "./spec";

const LABELS = {
  add: "Add Vendor",
  createTitle: "New Vendor",
  createSubmit: "Create",
  editTitle: "Edit Vendor",
  editSubmit: "Save",
  titleField: "name",
  searchPlaceholder: "Search vendors",
  empty: "No vendors yet.",
  noResults: "No vendors match.",
  createErrorFallback: "Could not create the vendor.",
  updateErrorFallback: "Could not update the vendor.",
  networkError: "Network error — try again.",
  archiveTitle: "Archive vendor?",
  archiveMessage: "It can be restored later.",
  archiveConfirm: "Archive",
} as const;

function vendorRoute() {
  return defineRoute({
    title: "Vendors",
    basePath: "/api/vendors",
    softDeleteField: "is_active",
    testIdPrefix: "vendor",
    permissions: { view: "vendors.view", edit: ["vendors.edit"], delete: "vendors.delete" },
    header: {
      actions: [action("add", { label: "Add Vendor", flow: "vendors.create" })],
    },
    view: table({
      columns: [
        col("name", { title: "Name", orderable: true, render: Cell.Title }),
        col("kind", { title: "Kind", render: Cell.Enum({ a: "A", b: "B" }) }),
        col("notes", { title: "Notes", render: Cell.Text({ muted: true }) }),
      ],
    }),
    form: defineForm({
      fields: {
        name: field.text({ label: "Name", required: true, transform: "trim" }),
        notes: field.textarea({ label: "Notes", transform: "trimOrNull", rows: 3 }),
        kind: field.select({
          label: "Kind",
          default: "a",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        }),
      },
      submit: { create: "vendors.create", update: "vendors.update" },
    }),
    detail: [{ label: "Name", value: { type: "field", key: "name" } }],
    settings: { pageSize: setting.number({ default: 25 }) },
    labels: LABELS,
  });
}

describe("routeToResourceSpec lowering", () => {
  it("lowers a built route to the hand-authored ResourceUiSpec shape", () => {
    const lowered = routeToResourceSpec(vendorRoute());
    const hand: ResourceUiSpec = {
      basePath: "/api/vendors",
      title: "Vendors",
      permissions: { view: "vendors.view", edit: ["vendors.edit"], delete: "vendors.delete" },
      softDeleteField: "is_active",
      testIdPrefix: "vendor",
      columns: [
        { key: "name", title: "Name", orderable: true, render: { type: "title" } },
        { key: "kind", title: "Kind", render: { type: "enum", labels: { a: "A", b: "B" } } },
        { key: "notes", title: "Notes", render: { type: "text", muted: true } },
      ],
      fields: [
        { key: "name", label: "Name", type: "text", required: true, transform: "trim" },
        { key: "notes", label: "Notes", type: "textarea", transform: "trimOrNull", rows: 3 },
        {
          key: "kind",
          label: "Kind",
          type: "select",
          default: "a",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ],
      detail: [{ label: "Name", value: { type: "field", key: "name" } }],
      labels: LABELS,
    };
    expect(lowered).toEqual(hand);
  });

  it("omits `orderable` (does not emit false) when col() left it out", () => {
    const lowered = routeToResourceSpec(vendorRoute());
    expect("orderable" in lowered.columns[1]).toBe(false);
  });

  it("throws on a cards body (unwired view)", () => {
    const route = defineRoute({
      ...vendorRoute(),
      view: { kind: "cards", item: {} },
    });
    expect(() => routeToResourceSpec(route)).toThrow(/not wired/);
  });

  it("throws on a multi-view route", () => {
    const route = defineRoute({
      ...vendorRoute(),
      view: { views: { t: table({ columns: [] }) }, default: "t" },
    });
    expect(() => routeToResourceSpec(route)).toThrow(/multi-view/);
  });

  it("throws on an unwired field kind", () => {
    expect(() => fieldToUiField("due", { kind: "date", label: "Due" })).toThrow(/unwired kind/);
  });
});
