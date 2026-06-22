// The spec-driven default-datatable page: list + create + detail/edit + archive,
// composed from a ResourceUiSpec onto the ksui DataTable/Modal/FormField shell.
// This is the generic runtime that reproduces a hand-written base plugin's UI
// (proved byte-for-behavior against payees). A base plugin's `ui/remote/index.tsx`
// shrinks to: build a spec, render <ResourcePage spec={...} host={...} />.
//
// ksui stays standalone — it never imports `@kserp/host-ui`. The host primitives
// (PageShell, PageShareButton, and the workspace/permission hooks) are INJECTED
// via the `host` prop; the plugin passes them from its host UI kit, where the
// hooks run inside the plugin's own component tree (correct reactive context).
import { createSignal, For, Show, type Component, type JSX } from "solid-js";
import { createStore } from "solid-js/store";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import Archive from "lucide-solid/icons/archive";
import ArchiveRestore from "lucide-solid/icons/archive-restore";
import Pencil from "lucide-solid/icons/pencil";
import SegmentedFilter from "../../base/SegmentedFilter";
import Button from "../../base/Button";
import Modal from "../../base/Modal";
import DataTable, {
  type DataTableColumn,
  type FetchParams,
  type FetchResult,
} from "../../base/DataTable";
import { confirm } from "../../../utils/confirm";
import {
  buildListQuery,
  emptyFormValues,
  endpoints,
  formToBody,
  initialFilterState,
  rowToFormValues,
  validateForm,
  type ResourceRow,
  type ResourceUiSpec,
} from "./spec";
import { renderCell } from "./cells";
import { ResourceForm } from "./ResourceForm";
import { ResourceDetail } from "./ResourceDetail";

/**
 * Host primitives injected by the plugin so ksui never imports `@kserp/host-ui`.
 * The plugin's remote entry passes these from the host UI kit; the hooks are
 * invoked at the top of ResourcePage's render, inside the plugin's component
 * tree, so their reactive context resolves correctly.
 */
export interface ResourcePageHost {
  PageShell: Component<{
    title: string;
    subtitle?: string;
    actions?: JSX.Element;
    children: JSX.Element;
  }>;
  PageShareButton?: Component<{ module: string; moduleLabel: string }>;
  useActiveWorkspace: () => {
    activeWorkspace: () => { ws_id: number | string } | null | undefined;
  };
  usePermissions: () => {
    has: (code: string) => boolean;
    hasAny: (...codes: string[]) => boolean;
  };
}

export interface ResourcePageProps<T extends ResourceRow> {
  spec: ResourceUiSpec;
  host: ResourcePageHost;
  /** Test seam: override the fetch implementation (defaults to window.fetch). */
  fetchImpl?: typeof fetch;
}

type RefetchApi = { refetch: () => void; resetAndRefetch: () => void };

export function ResourcePage<T extends ResourceRow>(props: ResourcePageProps<T>) {
  const spec = props.spec;
  const ep = endpoints(spec);
  const doFetch = props.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  const { PageShell, PageShareButton } = props.host;
  const { activeWorkspace } = props.host.useActiveWorkspace();
  const perms = props.host.usePermissions();
  const canView = () => perms.has(spec.permissions.view);
  const canEdit = () => perms.hasAny(...spec.permissions.edit);
  const canDelete = () => perms.has(spec.permissions.delete);

  const [filterState, setFilterState] = createStore<Record<string, string>>(initialFilterState(spec));
  let refetchFn: RefetchApi | undefined;

  const [detailRow, setDetailRow] = createSignal<ResourceRow | null>(null);
  const [editing, setEditing] = createSignal(false);
  const [createOpen, setCreateOpen] = createSignal(false);

  const [form, setForm] = createStore<Record<string, string>>(emptyFormValues(spec));
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const setValue = (key: string, value: string) => setForm(key, value);

  function resetForm() {
    setForm(emptyFormValues(spec));
    setError("");
  }
  function populateForm(row: ResourceRow) {
    setForm(rowToFormValues(spec, row));
    setError("");
  }

  function wsHeaders(): Record<string, string> {
    const ws = activeWorkspace();
    return ws ? { "X-Workspace-Id": String(ws.ws_id) } : {};
  }

  async function openDetail(id: number) {
    try {
      const res = await doFetch(ep.one(id), { credentials: "include", headers: wsHeaders() });
      if (res.ok) {
        setDetailRow(await res.json());
        setEditing(false);
      }
    } catch {
      /* ignore */
    }
  }

  function startEdit() {
    const row = detailRow();
    if (!row) return;
    populateForm(row);
    setEditing(true);
  }

  async function submit(method: "POST" | "PUT", url: string, fallback: string, onOk: (row: ResourceRow) => void) {
    const msg = validateForm(spec, form);
    if (msg) {
      setError(msg);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await doFetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...wsHeaders() },
        body: JSON.stringify(formToBody(spec, form)),
      });
      // create allows the idempotent-200 path; both treat non-ok as an error
      if (!res.ok && !(method === "POST" && res.status === 200)) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || fallback);
        return;
      }
      onOk(await res.json().catch(() => ({})));
      refetchFn?.refetch();
    } catch {
      setError(spec.labels.networkError);
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    await submit("POST", ep.create, spec.labels.createErrorFallback, () => {
      setCreateOpen(false);
      resetForm();
    });
  }

  async function handleUpdate() {
    const row = detailRow();
    if (!row) return;
    await submit("PUT", ep.one(row.id), spec.labels.updateErrorFallback, (updated) => {
      if (updated && typeof updated.id === "number") setDetailRow(updated);
      setEditing(false);
    });
  }

  async function handleArchive(id: number) {
    if (
      !(await confirm({
        title: spec.labels.archiveTitle,
        message: spec.labels.archiveMessage,
        confirmLabel: spec.labels.archiveConfirm,
        danger: true,
      }))
    )
      return;
    try {
      await doFetch(ep.one(id), { method: "DELETE", credentials: "include", headers: wsHeaders() });
      setDetailRow(null);
      refetchFn?.refetch();
    } catch {
      /* ignore */
    }
  }

  async function handleRestore(id: number) {
    try {
      const res = await doFetch(ep.restore(id), { method: "PATCH", credentials: "include", headers: wsHeaders() });
      if (res.ok) {
        setDetailRow(await res.json());
        refetchFn?.refetch();
      }
    } catch {
      /* ignore */
    }
  }

  const columns: DataTableColumn<ResourceRow>[] = spec.columns.map((c) => ({
    data: c.key,
    title: c.title,
    orderable: c.orderable ?? false,
    render: (_v, _t, row) => renderCell(spec, c, row, openDetail),
  }));

  return (
    <Show when={canView()}>
      <PageShell
        title={spec.title}
        subtitle={spec.subtitle}
        actions={
          <>
            <Show when={spec.share}>
              {(s) =>
                PageShareButton ? (
                  <PageShareButton module={s().module} moduleLabel={s().moduleLabel} />
                ) : null
              }
            </Show>
            <Show when={canEdit()}>
              <Button
                intent="primary"
                variant="clip1"
                icon={Plus}
                data-testid={`${spec.testIdPrefix}-add-btn`}
                onClick={() => {
                  resetForm();
                  setCreateOpen(true);
                }}
              >
                {spec.labels.add}
              </Button>
            </Show>
          </>
        }
      >
        <DataTable<ResourceRow>
          refetchKey={() => activeWorkspace()?.ws_id}
          fetchFn={async (params: FetchParams): Promise<FetchResult<ResourceRow>> => {
            const q = buildListQuery(spec, params, filterState);
            const res = await doFetch(`${ep.list}?${q}`, { credentials: "include", headers: wsHeaders() });
            return res.json();
          }}
          columns={columns}
          searching={true}
          ordering={true}
          paging={true}
          searchPlaceholder={spec.labels.searchPlaceholder}
          emptyMessage={spec.labels.empty}
          noResultsMessage={spec.labels.noResults}
          filters={
            <div class="flex items-center gap-2 flex-wrap">
              <For each={spec.filters ?? []}>
                {(f) =>
                  f.type === "segmented" ? (
                    <SegmentedFilter
                      options={[...f.options]}
                      value={filterState[f.param]}
                      onChange={(v: string) => setFilterState(f.param, v)}
                      testIdPrefix={f.testIdPrefix}
                    />
                  ) : (
                    <select
                      value={filterState[f.param]}
                      onChange={(e) => setFilterState(f.param, e.currentTarget.value)}
                      class="rounded-lg border border-zinc-800/50 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 cursor-pointer"
                    >
                      <For each={f.options}>{(o) => <option value={o.value}>{o.label}</option>}</For>
                    </select>
                  )
                }
              </For>
            </div>
          }
          onRefetch={(api) => {
            refetchFn = api;
          }}
        />
      </PageShell>

      {/* Create modal */}
      <Show when={createOpen()}>
        <Modal
          onClose={() => {
            setCreateOpen(false);
            resetForm();
          }}
          size="lg"
        >
          <div data-testid={`${spec.testIdPrefix}-create-modal`}>
            <div class="flex items-center justify-between mb-6">
              <h2 class="text-lg font-semibold text-zinc-100">{spec.labels.createTitle}</h2>
              <button
                onClick={() => {
                  setCreateOpen(false);
                  resetForm();
                }}
                class="text-zinc-500 hover:text-zinc-300 cursor-pointer"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <ResourceForm
              spec={spec}
              values={form}
              setValue={setValue}
              error={error()}
              saving={saving()}
              submitLabel={spec.labels.createSubmit}
              onSubmit={handleCreate}
              onCancel={() => {
                setCreateOpen(false);
                resetForm();
              }}
            />
          </div>
        </Modal>
      </Show>

      {/* Detail / edit modal */}
      <Show when={detailRow()}>
        {(row) => (
          <Modal
            onClose={() => {
              setDetailRow(null);
              setEditing(false);
            }}
            size="lg"
          >
            <div data-testid={`${spec.testIdPrefix}-detail-modal`}>
              <div class="flex items-center justify-between mb-6">
                <h2 class="text-lg font-semibold text-zinc-100">
                  {editing() ? spec.labels.editTitle : String(row()[spec.labels.titleField] ?? "")}
                </h2>
                <div class="flex items-center gap-2">
                  <Show when={!editing() && canEdit()}>
                    <button
                      onClick={startEdit}
                      class="text-zinc-500 hover:text-amber-400 cursor-pointer p-1"
                      title="Edit"
                      aria-label="Edit"
                    >
                      <Pencil size={16} />
                    </button>
                  </Show>
                  <Show when={!editing() && canDelete()}>
                    {row()[spec.softDeleteField] ? (
                      <button
                        onClick={() => handleArchive(row().id)}
                        class="text-zinc-500 hover:text-red-400 cursor-pointer p-1"
                        title="Archive"
                        aria-label="Archive"
                      >
                        <Archive size={16} />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRestore(row().id)}
                        class="text-zinc-500 hover:text-emerald-400 cursor-pointer p-1"
                        title="Restore"
                        aria-label="Restore"
                      >
                        <ArchiveRestore size={16} />
                      </button>
                    )}
                  </Show>
                  <button
                    onClick={() => {
                      setDetailRow(null);
                      setEditing(false);
                    }}
                    class="text-zinc-500 hover:text-zinc-300 cursor-pointer p-1"
                    aria-label="Close"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              <Show when={editing()} fallback={<ResourceDetail rows={spec.detail} row={row()} />}>
                <ResourceForm
                  spec={spec}
                  values={form}
                  setValue={setValue}
                  error={error()}
                  saving={saving()}
                  submitLabel={spec.labels.editSubmit}
                  onSubmit={handleUpdate}
                  onCancel={() => setEditing(false)}
                />
              </Show>
            </div>
          </Modal>
        )}
      </Show>
    </Show>
  );
}
