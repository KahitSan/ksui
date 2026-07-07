// Remote UI module for the financial-accounts plugin.
//
// Built to an IIFE that the plugin process serves (server/main.ts → /_ui). The
// host's generic catch-all route loads it at runtime, keyed off the manifest's
// uiRouteBase ("financial-accounts"), and renders <Component/> in its own
// component tree. solid-js and the host's shared UI kit are EXTERNALIZED to
// globals the host provides (see vite.remote.config.ts), so this runs on the
// host's single Solid runtime and reuses the exact host components.
//
// 1:1 port of the monolith kplugins/financial-accounts/ui/routes/index.tsx.
// Deferred vs the monolith:
//   - BALANCE arrives from the transactions plugin via server-side RPC; the
//     column renders the value when present and "—" when the plugin is off.
//   - LOGO upload is fully supported (POST /logo, DELETE /logo, ImageCropper).

import { createSignal, Show, For, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import {
  PageShell,
  PageShareButton,
  useActiveWorkspace,
  usePermissions,
  PermissionGate,
} from "@kserp/host-ui";

import {
  AccountAvatar,
  Button,
  Modal,
  DataTable,
  StatusPill,
  type DataTableColumn,
  type FetchParams,
  type FetchResult,
  type AccountIconSlug,
} from "@kahitsan/ksui";
import { runFlow } from "@kahitsan/plugin-sdk/flow";
import {
  createFlow,
  updateFlow,
  renameFlow,
  archiveFlow,
  restoreFlow,
} from "../../server/flows-accounts.js";
import { AccountForm } from "./components/AccountForm";
import { AccountDetail } from "./components/AccountDetail";
import {
  type FinancialAccount,
  TYPE_LABELS,
  capitalRowFigures,
  formatCurrency,
} from "./lib/accounts.js";

import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import Archive from "lucide-solid/icons/archive";
import ArchiveRestore from "lucide-solid/icons/archive-restore";
import Pencil from "lucide-solid/icons/pencil";
import EllipsisVertical from "lucide-solid/icons/ellipsis-vertical";
import Eye from "lucide-solid/icons/eye";
import AlertTriangle from "lucide-solid/icons/triangle-alert";

export default function AccountsPage() {
  const { activeWorkspace } = useActiveWorkspace();
  const perms = usePermissions();
  const canAccess = () => perms.has("financial_accounts.view");

  const isAdmin = () =>
    perms.hasAny(
      "financial_accounts.create",
      "financial_accounts.edit",
      "financial_accounts.delete"
    );

  // Build workspace header for every fetch call.
  function wsHeaders(): HeadersInit {
    const wsId =
      activeWorkspace()?.ws_id ??
      (typeof window !== "undefined"
        ? localStorage.getItem("ks_active_workspace_id") ?? ""
        : "");
    return wsId ? { "X-Workspace-Id": String(wsId) } : {};
  }

  // runFlow's ctx.fetch — merges the workspace header onto whatever init the
  // flow runtime built (it only sets Content-Type), and pins credentials.
  const flowFetch: (url: string, init?: RequestInit) => Promise<Response> = (
    url,
    init
  ) =>
    fetch(url, {
      ...init,
      credentials: "include",
      headers: { ...(init?.headers as Record<string, string>), ...wsHeaders() },
    });

  const [statusFilter, setStatusFilter] = createSignal("active");
  let refetchFn:
    | { refetch: () => void; resetAndRefetch: () => void }
    | undefined;

  const [detailAccount, setDetailAccount] =
    createSignal<FinancialAccount | null>(null);
  const [editing, setEditing] = createSignal(false);
  const [createOpen, setCreateOpen] = createSignal(false);

  // Rename modal state
  const [renameTarget, setRenameTarget] = createSignal<FinancialAccount | null>(
    null
  );
  const [renameName, setRenameName] = createSignal("");
  const [renameSaving, setRenameSaving] = createSignal(false);
  const [renameError, setRenameError] = createSignal("");

  // Archive confirmation state
  const [confirmTarget, setConfirmTarget] =
    createSignal<FinancialAccount | null>(null);
  const [confirmBusy, setConfirmBusy] = createSignal(false);

  // Row action menu state
  const [openMenuId, setOpenMenuId] = createSignal<number | null>(null);
  const [menuPos, setMenuPos] = createSignal<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  // Shared form state
  const [formName, setFormName] = createSignal("");
  const [formType, setFormType] = createSignal("cash");
  const [formDescription, setFormDescription] = createSignal("");
  const [formIcon, setFormIcon] = createSignal<AccountIconSlug | "">("");
  const [formColor, setFormColor] = createSignal("");
  const [formLogoBlob, setFormLogoBlob] = createSignal<Blob | null>(null);
  // Public object-storage URL (s3_link) of the saved logo, when there is one —
  // the sole reference for the edit preview now that logo_path is gone.
  const [formLogoExistingS3, setFormLogoExistingS3] = createSignal<
    string | null
  >(null);
  const [formLogoClear, setFormLogoClear] = createSignal(false);
  const [formSaving, setFormSaving] = createSignal(false);
  const [formError, setFormError] = createSignal("");

  function resetForm() {
    setFormName("");
    setFormType("cash");
    setFormDescription("");
    setFormIcon("");
    setFormColor("");
    setFormLogoBlob(null);
    setFormLogoExistingS3(null);
    setFormLogoClear(false);
    setFormError("");
  }

  function populateForm(a: FinancialAccount) {
    setFormName(a.name);
    setFormType(a.type);
    setFormDescription(a.description || "");
    setFormIcon((a.icon as AccountIconSlug | null) ?? "");
    setFormColor(a.color ?? "");
    setFormLogoBlob(null);
    setFormLogoExistingS3(a.s3_link);
    setFormLogoClear(false);
    setFormError("");
  }

  async function uploadLogo(
    accountId: number,
    blob: Blob
  ): Promise<FinancialAccount | null> {
    const fd = new FormData();
    fd.append("file", blob, "logo.webp");
    const res = await fetch(`/api/financial-accounts/${accountId}/logo`, {
      method: "POST",
      credentials: "include",
      headers: wsHeaders(),
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setFormError(
        (err as { error?: string }).error || "Failed to upload logo"
      );
      return null;
    }
    return (await res.json()) as FinancialAccount;
  }

  async function clearLogo(
    accountId: number
  ): Promise<FinancialAccount | null> {
    const res = await fetch(`/api/financial-accounts/${accountId}/logo`, {
      method: "DELETE",
      credentials: "include",
      headers: wsHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setFormError(
        (err as { error?: string }).error || "Failed to remove logo"
      );
      return null;
    }
    return (await res.json()) as FinancialAccount;
  }

  async function openDetail(id: number) {
    try {
      const res = await fetch(`/api/financial-accounts/${id}`, {
        credentials: "include",
        headers: wsHeaders(),
      });
      if (res.ok) {
        setDetailAccount((await res.json()) as FinancialAccount);
        setEditing(false);
      }
    } catch {
      /* ignore */
    }
  }

  function startEdit() {
    const a = detailAccount();
    if (!a) return;
    populateForm(a);
    setEditing(true);
  }

  async function handleCreate() {
    // §9 EXECUTION: the declared createFlow IS this behaviour — runFlow walks
    // submit → commit (POST) → ok? → refresh|toast, the exact graph the
    // Connections tab renders. The logo upload + edit-mode recovery is UI
    // form-state orchestration and stays in the success effect closure.
    if (!formName().trim()) {
      setFormError("Name is required");
      return;
    }
    setFormSaving(true);
    setFormError("");
    const flowState: Record<string, unknown> = {
      body: {
        name: formName().trim(),
        type: formType(),
        description: formDescription().trim() || null,
        icon: formIcon() || null,
        color: formColor() || null,
      },
    };
    try {
      await runFlow(createFlow, "submit", {
        state: flowState,
        fetch: flowFetch,
        ui: {
          refresh: async () => {
            const created = flowState.commit as FinancialAccount;
            const pendingBlob = formLogoBlob();
            let logoError: string | null = null;
            let finalAccount: FinancialAccount = created;
            if (pendingBlob) {
              const withLogo = await uploadLogo(created.id, pendingBlob);
              if (withLogo) {
                finalAccount = withLogo;
              } else {
                logoError = formError() || "Logo failed to save";
              }
            }

            setCreateOpen(false);
            resetForm();
            refetchFn?.refetch();

            if (logoError) {
              populateForm(finalAccount);
              setDetailAccount(finalAccount);
              setEditing(true);
              setFormError(logoError);
            }
          },
          toast: () => setFormError("Failed to create account"),
        },
      });
    } catch {
      setFormError("Network error");
    } finally {
      setFormSaving(false);
    }
  }

  async function handleUpdate() {
    // §9 EXECUTION: the declared updateFlow IS this behaviour — runFlow walks
    // save → commit (PUT) → ok? → refresh|toast. The logo upload/clear + exit-
    // edit is UI form-state orchestration and stays in the success closure.
    const a = detailAccount();
    if (!a) return;
    if (!formName().trim()) {
      setFormError("Name is required");
      return;
    }
    setFormSaving(true);
    setFormError("");
    const flowState: Record<string, unknown> = {
      id: a.id,
      body: {
        name: formName().trim(),
        type: formType(),
        description: formDescription().trim() || null,
        icon: formIcon() || null,
        color: formColor() || null,
      },
    };
    try {
      await runFlow(updateFlow, "save", {
        state: flowState,
        fetch: flowFetch,
        ui: {
          refresh: async () => {
            let updated = flowState.commit as FinancialAccount;

            const pendingBlob = formLogoBlob();
            let logoFailed = false;
            if (pendingBlob) {
              const withLogo = await uploadLogo(a.id, pendingBlob);
              if (withLogo) {
                updated = withLogo;
              } else {
                logoFailed = true;
              }
            } else if (formLogoClear() && formLogoExistingS3()) {
              const withoutLogo = await clearLogo(a.id);
              if (withoutLogo) {
                updated = withoutLogo;
              } else {
                logoFailed = true;
              }
            }

            setDetailAccount(updated);
            setFormLogoExistingS3(updated.s3_link);
            refetchFn?.refetch();
            if (logoFailed) return;
            setEditing(false);
            setFormLogoBlob(null);
            setFormLogoClear(false);
          },
          toast: () => setFormError("Failed to update account"),
        },
      });
    } catch {
      setFormError("Network error");
    } finally {
      setFormSaving(false);
    }
  }

  async function handleRestore(id: number) {
    // §9 EXECUTION: restoreFlow — restore → commit (PATCH) → ok? → refresh.
    const flowState: Record<string, unknown> = { id };
    await runFlow(restoreFlow, "restore", {
      state: flowState,
      fetch: flowFetch,
      ui: {
        refresh: () => {
          const restored = flowState.commit as FinancialAccount;
          if (detailAccount()?.id === id) setDetailAccount(restored);
          refetchFn?.refetch();
        },
      },
    });
  }

  function openRename(account: FinancialAccount) {
    setRenameName(account.name);
    setRenameError("");
    setRenameTarget(account);
    setOpenMenuId(null);
  }

  async function handleRename() {
    const target = renameTarget();
    if (!target) return;
    const trimmed = renameName().trim();
    if (!trimmed) {
      setRenameError("Name is required");
      return;
    }
    if (trimmed === target.name) {
      setRenameTarget(null);
      return;
    }
    setRenameSaving(true);
    setRenameError("");
    // §9 EXECUTION: renameFlow — submit → commit (PUT name) → ok? → refresh|toast.
    const flowState: Record<string, unknown> = {
      id: target.id,
      body: { name: trimmed },
    };
    try {
      await runFlow(renameFlow, "submit", {
        state: flowState,
        fetch: flowFetch,
        ui: {
          refresh: () => {
            const updated = flowState.commit as FinancialAccount;
            if (detailAccount()?.id === target.id) setDetailAccount(updated);
            setRenameTarget(null);
            refetchFn?.refetch();
          },
          toast: () => setRenameError("Failed to rename"),
        },
      });
    } catch {
      setRenameError("Network error");
    } finally {
      setRenameSaving(false);
    }
  }

  function requestArchive(account: FinancialAccount) {
    setConfirmTarget(account);
    setOpenMenuId(null);
  }

  async function confirmArchive() {
    // §9 EXECUTION: archiveFlow — yes → commit (DELETE) → ok? → refresh. The
    // soft-delete returns 204 (empty body), so the fetch wrapper records res.ok
    // into flowState.ok for the condition to branch on (a null body can't).
    const target = confirmTarget();
    if (!target) return;
    setConfirmBusy(true);
    const flowState: Record<string, unknown> = { id: target.id, ok: false };
    try {
      await runFlow(archiveFlow, "yes", {
        state: flowState,
        fetch: async (url: string, init?: RequestInit) => {
          const res = await flowFetch(url, init);
          flowState.ok = res.ok;
          return res;
        },
        ui: {
          refresh: () => {
            if (detailAccount()?.id === target.id) setDetailAccount(null);
            setConfirmTarget(null);
            refetchFn?.refetch();
          },
        },
      });
    } catch {
      /* ignore */
    } finally {
      setConfirmBusy(false);
    }
  }

  if (typeof window !== "undefined") {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openMenuId()) {
        setOpenMenuId(null);
      }
    };
    window.addEventListener("keydown", handleKey);

    const handleOutsideClick = (e: MouseEvent) => {
      if (
        openMenuId() &&
        !(e.target as HTMLElement)?.closest("[data-action-menu]")
      ) {
        setOpenMenuId(null);
      }
    };
    window.addEventListener("click", handleOutsideClick);

    onCleanup(() => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("click", handleOutsideClick);
    });
  }

  const columns = (): DataTableColumn<FinancialAccount>[] => [
    {
      data: "name",
      title: "Name",
      orderable: true,
      render: (_val, _type, row) => (
        <button
          class="flex items-center gap-2 text-left text-zinc-200 hover:text-amber-400 transition-colors cursor-pointer"
          onClick={() => openDetail(row.id)}
        >
          <AccountAvatar account={row} size={28} />
          <span>{row.name}</span>
        </button>
      ),
    },
    {
      data: "type",
      title: "Type",
      orderable: true,
      render: (_val, _type, row) => {
        const t = TYPE_LABELS[row.type] || {
          label: row.type,
          class: "border-zinc-700 text-zinc-400",
        };
        return (
          <span
            class={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider border ${t.class}`}
          >
            {t.label}
          </span>
        );
      },
    },
    {
      data: null,
      title: "Balance",
      render: (_val, _type, row) => {
        if (row.balance === undefined || row.balance === null) {
          return <span class="text-zinc-500">—</span>;
        }
        if (row.type === "capital") {
          const fig = capitalRowFigures(row.balance);
          if (fig.overpaid) {
            return (
              <div class="flex flex-col">
                <span class="text-sm font-medium text-red-400">
                  +{formatCurrency(fig.overpayment)}
                </span>
                <span class="text-[10px] uppercase tracking-wider text-red-400/70">
                  overpaid
                </span>
              </div>
            );
          }
          return (
            <div class="flex flex-col">
              <span class="text-sm font-medium text-amber-400">
                {formatCurrency(fig.outstanding)}
              </span>
              <span class="text-[10px] uppercase tracking-wider text-zinc-500">
                {fig.outstanding === 0 ? "settled" : "to return"}
              </span>
            </div>
          );
        }
        const bal =
          typeof row.balance === "string"
            ? parseFloat(row.balance)
            : row.balance;
        return (
          <span
            class="text-sm font-medium"
            classList={{
              "text-emerald-400": bal > 0,
              "text-red-400": bal < 0,
              "text-zinc-400": bal === 0,
            }}
          >
            {formatCurrency(row.balance)}
          </span>
        );
      },
    },
    {
      data: "is_active",
      title: "Status",
      orderable: true,
      render: (_val, _type, row) => (
        <StatusPill
          tone={row.is_active ? "success" : "neutral"}
          label={row.is_active ? "Active" : "Archived"}
          solid={row.is_active}
        />
      ),
    },
    ...(isAdmin()
      ? [
          {
            data: null as unknown as keyof FinancialAccount,
            title: "",
            render: (_val: unknown, _type: unknown, row: FinancialAccount) => (
              <div data-action-menu>
                <button
                  class="p-1 text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer rounded hover:bg-zinc-800/50"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (openMenuId() === row.id) {
                      setOpenMenuId(null);
                    } else {
                      const rect = (
                        e.currentTarget as HTMLElement
                      ).getBoundingClientRect();
                      setMenuPos({
                        top: rect.bottom + 4,
                        left: rect.right - 176,
                      });
                      setOpenMenuId(row.id);
                    }
                  }}
                  title="Actions"
                >
                  <EllipsisVertical size={16} />
                </button>
                <Show when={openMenuId() === row.id}>
                  <Portal>
                    <div
                      class="fixed z-50 w-44 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl py-1"
                      style={{
                        top: `${menuPos().top}px`,
                        left: `${menuPos().left}px`,
                      }}
                      data-action-menu
                    >
                      <button
                        class="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(null);
                          openDetail(row.id);
                        }}
                      >
                        <Eye size={14} />
                        Open
                      </button>
                      <button
                        class="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          openRename(row);
                        }}
                      >
                        <Pencil size={14} />
                        Rename
                      </button>
                      <div class="my-1 border-t border-zinc-800" />
                      {row.is_active ? (
                        <button
                          class="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            requestArchive(row);
                          }}
                        >
                          <Archive size={14} />
                          Archive
                        </button>
                      ) : (
                        <button
                          class="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-400 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            handleRestore(row.id);
                          }}
                        >
                          <ArchiveRestore size={14} />
                          Restore
                        </button>
                      )}
                    </div>
                  </Portal>
                </Show>
              </div>
            ),
          } satisfies DataTableColumn<FinancialAccount>,
        ]
      : []),
  ];

  return (
    <>
      <PermissionGate when={canAccess()}>
        <PageShell
          title="Financial Accounts"
          subtitle="Manage bank accounts, e-wallets, and cash funds"
          actions={
            <>
              <PageShareButton
                module="financial_accounts"
                moduleLabel="Financial Accounts"
              />
              <Show when={isAdmin()}>
                <Button
                  intent="primary"
                  variant="clip1"
                  icon={Plus}
                  data-testid="accounts-add-btn"
                  onClick={() => {
                    resetForm();
                    setCreateOpen(true);
                  }}
                >
                  Add Account
                </Button>
              </Show>
            </>
          }
        >
          <DataTable<FinancialAccount>
            refetchKey={() => activeWorkspace()?.ws_id}
            fetchFn={async (
              params: FetchParams
            ): Promise<FetchResult<FinancialAccount>> => {
              const q = new URLSearchParams({
                page: String(params.page),
                limit: String(params.limit),
                search: params.search,
                sortBy: params.sortBy || "",
                sortDir: params.sortDir,
                status: statusFilter(),
              });
              const res = await fetch(`/api/financial-accounts?${q}`, {
                credentials: "include",
                headers: wsHeaders(),
              });
              return res.json() as Promise<FetchResult<FinancialAccount>>;
            }}
            columns={columns()}
            searching={true}
            ordering={true}
            paging={true}
            searchPlaceholder="Search by name or description..."
            emptyMessage="No financial accounts yet. Click 'Add Account' to create one."
            noResultsMessage="No accounts match your search."
            filters={
              <div class="flex items-center gap-2 flex-wrap">
                <div class="flex rounded-lg border border-zinc-800/50 overflow-hidden">
                  <For each={["active", "archived", "all"]}>
                    {(s) => (
                      <button
                        data-testid={`accounts-filter-${s}`}
                        onClick={() => setStatusFilter(s)}
                        class="px-3 py-1.5 text-xs capitalize transition-colors cursor-pointer"
                        classList={{
                          "bg-amber-500/20 text-amber-400":
                            statusFilter() === s,
                          "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50":
                            statusFilter() !== s,
                        }}
                      >
                        {s}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            }
            onRefetch={(api) => {
              refetchFn = api;
            }}
          />
        </PageShell>

        {/* Create Modal */}
        <Show when={createOpen()}>
          <Modal
            onClose={() => {
              setCreateOpen(false);
              resetForm();
            }}
            size="lg"
          >
            <div
              data-testid="accounts-create-modal"
              class="flex items-center justify-between mb-6"
            >
              <h2 class="text-lg font-semibold text-zinc-100">New Account</h2>
              <button
                onClick={() => {
                  setCreateOpen(false);
                  resetForm();
                }}
                class="text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            <AccountForm
              error={formError()}
              saving={formSaving()}
              name={formName()}
              setName={setFormName}
              type={formType()}
              setType={setFormType}
              description={formDescription()}
              setDescription={setFormDescription}
              icon={formIcon()}
              setIcon={setFormIcon}
              color={formColor()}
              setColor={setFormColor}
              logoBlob={formLogoBlob()}
              setLogoBlob={setFormLogoBlob}
              logoExistingS3={formLogoExistingS3()}
              logoClear={formLogoClear()}
              setLogoClear={setFormLogoClear}
              wsHeaders={wsHeaders}
              onSubmit={handleCreate}
              submitLabel="Create Account"
            />
          </Modal>
        </Show>

        {/* Detail Modal */}
        <Show when={detailAccount()}>
          {(account) => (
            <Modal
              onClose={() => {
                setDetailAccount(null);
                setEditing(false);
              }}
              size="lg"
            >
              <div
                data-testid="accounts-detail-modal"
                class="flex items-center justify-between mb-6"
              >
                <h2 class="text-lg font-semibold text-zinc-100">
                  {editing() ? "Edit Account" : account().name}
                </h2>
                <div class="flex items-center gap-2">
                  <Show when={!editing() && isAdmin()}>
                    <button
                      data-testid="accounts-edit-btn"
                      onClick={startEdit}
                      class="text-zinc-500 hover:text-amber-400 cursor-pointer p-1"
                      title="Edit"
                    >
                      <Pencil size={16} />
                    </button>
                  </Show>
                  <Show when={!editing() && isAdmin()}>
                    {account().is_active ? (
                      <button
                        data-testid="accounts-archive-btn"
                        onClick={() => requestArchive(account())}
                        class="text-zinc-500 hover:text-red-400 cursor-pointer p-1"
                        title="Archive"
                      >
                        <Archive size={16} />
                      </button>
                    ) : (
                      <button
                        data-testid="accounts-restore-btn"
                        onClick={() => handleRestore(account().id)}
                        class="text-zinc-500 hover:text-emerald-400 cursor-pointer p-1"
                        title="Restore"
                      >
                        <ArchiveRestore size={16} />
                      </button>
                    )}
                  </Show>
                  <button
                    data-testid="accounts-detail-close"
                    onClick={() => {
                      setDetailAccount(null);
                      setEditing(false);
                    }}
                    class="text-zinc-500 hover:text-zinc-300 cursor-pointer p-1"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              <Show
                when={editing()}
                fallback={
                  <AccountDetail account={account()} wsHeaders={wsHeaders} />
                }
              >
                <AccountForm
                  error={formError()}
                  saving={formSaving()}
                  name={formName()}
                  setName={setFormName}
                  type={formType()}
                  setType={setFormType}
                  description={formDescription()}
                  setDescription={setFormDescription}
                  icon={formIcon()}
                  setIcon={setFormIcon}
                  color={formColor()}
                  setColor={setFormColor}
                  accountId={account().id}
                  logoBlob={formLogoBlob()}
                  setLogoBlob={setFormLogoBlob}
                  logoExistingS3={formLogoExistingS3()}
                  logoClear={formLogoClear()}
                  setLogoClear={setFormLogoClear}
                  wsHeaders={wsHeaders}
                  onSubmit={handleUpdate}
                  submitLabel="Save Changes"
                  onCancel={() => setEditing(false)}
                />
              </Show>
            </Modal>
          )}
        </Show>

        {/* Rename Modal */}
        <Show when={renameTarget()}>
          {(_target) => (
            <Modal onClose={() => setRenameTarget(null)} size="sm">
              <div class="flex items-center justify-between mb-4">
                <h2 class="text-lg font-semibold text-zinc-100">
                  Rename Account
                </h2>
                <button
                  onClick={() => setRenameTarget(null)}
                  class="text-zinc-500 hover:text-zinc-300 cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRename();
                }}
                class="space-y-4"
              >
                <Show when={renameError()}>
                  <div class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                    {renameError()}
                  </div>
                </Show>
                <div>
                  <label class="block text-xs text-zinc-500 mb-1">Name</label>
                  <input
                    type="text"
                    value={renameName()}
                    onInput={(e) => setRenameName(e.target.value)}
                    class="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500/50 focus:outline-none"
                    autofocus
                    required
                  />
                </div>
                <div class="flex justify-end gap-3">
                  <Button
                    intent="secondary"
                    variant="ghost"
                    onClick={() => setRenameTarget(null)}
                    disabled={renameSaving()}
                  >
                    Cancel
                  </Button>
                  <Button
                    intent="primary"
                    variant="clip1"
                    disabled={renameSaving()}
                    onClick={handleRename}
                  >
                    {renameSaving() ? "Saving..." : "Rename"}
                  </Button>
                </div>
              </form>
            </Modal>
          )}
        </Show>

        {/* Archive Confirmation Modal */}
        <Show when={confirmTarget()}>
          {(target) => (
            <Modal
              onClose={() => !confirmBusy() && setConfirmTarget(null)}
              size="md"
              tone="danger"
            >
              <div class="flex items-start gap-3 mb-4">
                <AlertTriangle
                  size={22}
                  class="text-red-400 flex-shrink-0 mt-0.5"
                />
                <div>
                  <h2 class="text-lg font-semibold text-white">
                    Archive this account?
                  </h2>
                  <p class="text-xs text-zinc-400 mt-1">
                    The account will be hidden from the active list. You can
                    restore it later from the archived tab.
                  </p>
                </div>
              </div>

              <div class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 mb-4 text-sm">
                <p class="text-white font-medium">{target().name}</p>
                <p class="text-zinc-500 text-xs mt-0.5">
                  {TYPE_LABELS[target().type]?.label || target().type}
                  {target().balance !== undefined && target().balance !== null
                    ? ` · ${formatCurrency(target().balance!)}`
                    : ""}
                </p>
              </div>

              <div class="flex gap-2">
                <Button
                  intent="secondary"
                  variant="clip2"
                  disabled={confirmBusy()}
                  onClick={() => setConfirmTarget(null)}
                  class="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  intent="danger"
                  variant="clip1"
                  data-testid="accounts-confirm-archive-btn"
                  disabled={confirmBusy()}
                  onClick={confirmArchive}
                  class="flex-1"
                >
                  {confirmBusy() ? "Archiving..." : "Archive"}
                </Button>
              </div>
            </Modal>
          )}
        </Show>
      </PermissionGate>
    </>
  );
}
