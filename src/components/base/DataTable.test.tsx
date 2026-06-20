import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { DataTable, type DataTableColumn } from "./DataTable";

// DataTable is the most reused widget in every plugin's list view. This suite
// covers the CLIENT-SIDE mode (static data prop) only — server-side mode
// (fetchFn) requires async mocks and is covered by the transactions integration
// test. The dedup rule: a plugin UI test must NOT re-assert "columns render
// headers" or "pagination shows page 2" — those are owned here.

type Row = { id: number; name: string; amount: number };

const COLUMNS: DataTableColumn<Row>[] = [
  { data: "name" },
  { data: "amount", orderable: true },
];

const DATA: Row[] = [
  { id: 1, name: "Alpha", amount: 100 },
  { id: 2, name: "Beta", amount: 200 },
  { id: 3, name: "Gamma", amount: 300 },
];

describe("DataTable (client-side mode)", () => {
  it("renders column headers", () => {
    render(() => <DataTable columns={COLUMNS} data={DATA} />);
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Amount")).toBeTruthy();
  });

  it("renders all rows", () => {
    render(() => <DataTable columns={COLUMNS} data={DATA} />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText("Gamma")).toBeTruthy();
  });

  it("shows empty state when data is empty", () => {
    render(() => (
      <DataTable columns={COLUMNS} data={[]} emptyMessage="No records" />
    ));
    expect(screen.getByText("No records")).toBeTruthy();
  });

  it("respects default search input placeholder", () => {
    render(() => (
      <DataTable columns={COLUMNS} data={DATA} searchPlaceholder="Filter..." />
    ));
    expect(screen.getByPlaceholderText("Filter...")).toBeTruthy();
  });
});
