import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { ResourcePage } from "./ResourcePage";
import type { ResourceRow, ResourceUiSpec } from "./spec";

const ACTIVE: ResourceRow = { id: 1, name: "Active resource", archived: 1 };
const ARCHIVED: ResourceRow = { id: 2, name: "Archived resource", archived: false };

const SPEC: ResourceUiSpec = {
  basePath: "/api/resources",
  title: "Resources",
  permissions: {
    view: "resources.view",
    create: "resources.create",
    edit: ["resources.edit"],
    delete: "resources.delete",
    restore: "resources.restore",
  },
  softDeleteField: "archived",
  columns: [
    { key: "name", title: "Name", render: { type: "title" } },
  ],
  fields: [
    { key: "name", label: "Name", type: "text", required: true, transform: "trim" },
  ],
  detail: [{ label: "Name", value: { type: "field", key: "name" } }],
  labels: {
    add: "Add resource",
    createTitle: "Create resource",
    createSubmit: "Create",
    editTitle: "Edit resource",
    editSubmit: "Save",
    titleField: "name",
    searchPlaceholder: "Search resources",
    empty: "No resources",
    noResults: "No matching resources",
    createErrorFallback: "Create failed",
    updateErrorFallback: "Update failed",
    networkError: "Network failed",
    archiveTitle: "Archive resource",
    archiveMessage: "Archive this resource?",
    archiveConfirm: "Archive",
  },
  testIdPrefix: "resources",
};

function host(can: (permission: string) => boolean) {
  return {
    PageShell: (props: { title: string; actions?: JSX.Element; children: JSX.Element }) => (
      <section>
        <h1>{props.title}</h1>
        <div>{props.actions}</div>
        {props.children}
      </section>
    ),
    can,
  };
}

function fetchFor(rows: ResourceRow[], detail = rows[0], failure?: { method: string; body: string }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (failure && method === failure.method && url.endsWith(failure.body)) {
      return new Response(JSON.stringify({ error: `${method} failed visibly` }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (method === "GET" && url.includes("/api/resources/")) {
      return new Response(JSON.stringify(detail), { status: 200 });
    }
    if (method === "GET") {
      return new Response(JSON.stringify({ data: rows, total: rows.length }), { status: 200 });
    }
    return new Response(JSON.stringify(detail), { status: 200 });
  });
}

async function openDetail(fetchImpl: ReturnType<typeof fetchFor>, rowName: string) {
  await screen.findByText(rowName);
  fireEvent.click(screen.getByText(rowName));
  await screen.findByTestId("resources-detail-modal");
  expect(fetchImpl).toHaveBeenCalledWith("/api/resources/1", expect.anything());
}

describe("ResourcePage permission gates and mutation failures", () => {
  it("gates the page on view permission", async () => {
    const fetchImpl = fetchFor([ACTIVE]);
    render(() => <ResourcePage spec={SPEC} host={host(() => false)} fetchImpl={fetchImpl} />);
    expect(screen.queryByText("Resources")).toBeNull();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses create permission for add action, separately from edit permission", async () => {
    const fetchImpl = fetchFor([ACTIVE]);
    render(() => (
      <ResourcePage
        spec={SPEC}
        host={host((permission) => permission !== "resources.create")}
        fetchImpl={fetchImpl}
      />
    ));
    expect(screen.queryByRole("button", { name: "Add resource" })).toBeNull();
    await openDetail(fetchImpl, ACTIVE.name as string);
    expect(screen.getByLabelText("Edit")).toBeTruthy();
  });

  it("uses edit permission for edit action, separately from create permission", async () => {
    const fetchImpl = fetchFor([ACTIVE]);
    render(() => (
      <ResourcePage
        spec={SPEC}
        host={host((permission) => permission !== "resources.edit")}
        fetchImpl={fetchImpl}
      />
    ));
    expect(screen.getByRole("button", { name: "Add resource" })).toBeTruthy();
    await openDetail(fetchImpl, ACTIVE.name as string);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("uses restore permission for archived rows", async () => {
    const fetchImpl = fetchFor([ARCHIVED], ARCHIVED);
    render(() => (
      <ResourcePage
        spec={SPEC}
        host={host((permission) => permission !== "resources.restore")}
        fetchImpl={fetchImpl}
      />
    ));
    await screen.findByText(ARCHIVED.name as string);
    fireEvent.click(screen.getByText(ARCHIVED.name as string));
    await screen.findByTestId("resources-detail-modal");
    expect(screen.queryByTitle("Restore")).toBeNull();
  });

  it("does not use delete permission for restore affordance", async () => {
    const fetchImpl = fetchFor([ARCHIVED], ARCHIVED);
    render(() => (
      <ResourcePage
        spec={SPEC}
        host={host((permission) => permission !== "resources.delete")}
        fetchImpl={fetchImpl}
      />
    ));
    await screen.findByText(ARCHIVED.name as string);
    fireEvent.click(screen.getByText(ARCHIVED.name as string));
    await screen.findByTestId("resources-detail-modal");
    expect(screen.getByTitle("Restore")).toBeTruthy();
  });

  it("shows archive failure in detail modal", async () => {
    const fetchImpl = fetchFor([ACTIVE], ACTIVE, { method: "DELETE", body: "/api/resources/1" });
    render(() => <ResourcePage spec={SPEC} host={host(() => true)} fetchImpl={fetchImpl} />);
    await openDetail(fetchImpl, ACTIVE.name as string);
    fireEvent.click(screen.getByTitle("Archive"));
    const confirmDialog = await screen.findByTestId("confirm-dialog");
    fireEvent.click(confirmDialog.querySelector("button:last-child") as HTMLButtonElement);
    expect(await screen.findByText("DELETE failed visibly")).toBeTruthy();
    expect(screen.getByTestId("resources-detail-modal")).toBeTruthy();
  });

  it("shows restore failure in detail modal", async () => {
    const fetchImpl = fetchFor([ARCHIVED], ARCHIVED, { method: "PATCH", body: "/api/resources/2/restore" });
    render(() => <ResourcePage spec={SPEC} host={host(() => true)} fetchImpl={fetchImpl} />);
    await screen.findByText(ARCHIVED.name as string);
    fireEvent.click(screen.getByText(ARCHIVED.name as string));
    await screen.findByTestId("resources-detail-modal");
    fireEvent.click(screen.getByTitle("Restore"));
    expect(await screen.findByText("PATCH failed visibly")).toBeTruthy();
  });
});
