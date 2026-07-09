// Source: KahitSan/kserp src/components/ExportTransactionsModal.tsx (vendored into the plugin remote).
//
// CSV export modal: pick a date range → POST /api/transactions/export → stream
// progress over SSE → auto-download, plus a "Recent exports" list. Modal /
// Button / DatePicker come from the host UI kit. Degrades gracefully — if the
// export endpoint isn't implemented yet the modal lands in its error phase with
// a retry-able banner instead of crashing the page.

import {
  createSignal,
  createMemo,
  createResource,
  onCleanup,
  Show,
  For,
} from "solid-js";
import Download from "lucide-solid/icons/download";
import Loader2 from "lucide-solid/icons/loader-2";
import CheckCircle2 from "lucide-solid/icons/check-circle-2";
import AlertCircle from "lucide-solid/icons/alert-circle";
import { Modal, Button, DatePicker } from "@kahitsan/ksui";

interface ExportTransactionsModalProps {
  onClose: () => void;
}

const EXPORT_MAX_RANGE_DAYS = 730;

function rangeSpanInDays(from: string, to: string): number {
  const f = Date.parse(`${from}T00:00:00Z`);
  const t = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(f) || !Number.isFinite(t)) return 0;
  return Math.floor((t - f) / 86_400_000) + 1;
}

interface RecentJob {
  id: string;
  status: "pending" | "running" | "done" | "error" | "expired";
  date_from: string;
  date_to: string;
  consolidate: boolean;
  row_count: number | null;
  byte_size: string | number | null;
  filename: string | null;
  error_message: string | null;
  created_at: string;
  expires_at: string;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

function firstOfMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function formatBytes(b: number | string | null | undefined): string {
  const n = typeof b === "string" ? Number(b) : b ?? 0;
  if (!n || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function activeWorkspaceId(): string | null {
  try {
    return localStorage.getItem("ks_active_workspace_id");
  } catch {
    return null;
  }
}

// Append the active workspace as ?wsId so the kernel can resolve the tenant for
// requests that don't carry the host's X-Workspace-Id header — native fetch from
// the plugin bundle and EventSource (which can't set headers). Without it the
// kernel forwards no workspace and the plugin's requireWorkspace gate 400s.
function withWsId(url: string): string {
  const wsId = activeWorkspaceId();
  if (!wsId || url.includes("wsId=")) return url;
  return (
    url + (url.includes("?") ? "&" : "?") + "wsId=" + encodeURIComponent(wsId)
  );
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = withWsId(url);
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 0);
}

export default function ExportTransactionsModal(
  props: ExportTransactionsModalProps
) {
  const [dateFrom, setDateFrom] = createSignal<string | null>(
    firstOfMonthStr()
  );
  const [dateTo, setDateTo] = createSignal<string | null>(todayStr());
  const [consolidate, setConsolidate] = createSignal(false);

  const [phase, setPhase] = createSignal<
    "form" | "preparing" | "done" | "error"
  >("form");
  const [progressDone, setProgressDone] = createSignal(0);
  const [progressTotal, setProgressTotal] = createSignal(0);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  let currentEventSource: EventSource | null = null;
  onCleanup(() => currentEventSource?.close());

  const rangeError = createMemo<string | null>(() => {
    const f = dateFrom();
    const t = dateTo();
    if (!f || !t) return null;
    if (f > t) return "Start date must be on or before end date.";
    if (rangeSpanInDays(f, t) > EXPORT_MAX_RANGE_DAYS) {
      return `Pick at most ${EXPORT_MAX_RANGE_DAYS} days (about 2 years) per export.`;
    }
    return null;
  });

  const canPrepare = createMemo(() => {
    return (
      dateFrom() != null &&
      dateTo() != null &&
      rangeError() == null &&
      phase() === "form"
    );
  });

  const progressPct = createMemo(() => {
    const t = progressTotal();
    if (!t) return phase() === "done" ? 100 : 0;
    return Math.min(100, Math.round((progressDone() / t) * 100));
  });

  const [recentRefreshKey, setRecentRefreshKey] = createSignal(0);
  const [recent] = createResource(recentRefreshKey, async () => {
    const res = await fetch(withWsId("/api/transactions/export"), {
      credentials: "include",
    }).catch(() => null);
    if (!res || !res.ok) return [] as RecentJob[];
    const json = (await res.json()) as { jobs: RecentJob[] };
    return json.jobs;
  });

  async function handlePrepare() {
    setErrorMessage(null);
    setProgressDone(0);
    setProgressTotal(0);
    setPhase("preparing");
    try {
      const res = await fetch(withWsId("/api/transactions/export"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateFrom: dateFrom(),
          dateTo: dateTo(),
          consolidate: consolidate(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      const { jobId } = (await res.json()) as { jobId: string };

      const es = new EventSource(
        withWsId(`/api/transactions/export/${jobId}/progress`)
      );
      currentEventSource = es;
      let terminated = false;

      es.addEventListener("progress", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as {
            done: number;
            total: number;
            status: string;
          };
          setProgressDone(data.done);
          setProgressTotal(data.total);
        } catch {
          /* ignore malformed frames */
        }
      });

      es.addEventListener("done", (ev) => {
        terminated = true;
        try {
          const data = JSON.parse((ev as MessageEvent).data) as {
            filename: string;
            downloadUrl: string;
          };
          setPhase("done");
          triggerDownload(data.downloadUrl, data.filename);
          setRecentRefreshKey((k) => k + 1);
        } catch (err) {
          setErrorMessage(
            err instanceof Error ? err.message : "Failed to start download"
          );
          setPhase("error");
        } finally {
          es.close();
          currentEventSource = null;
        }
      });

      es.addEventListener("error", (ev) => {
        if (terminated) {
          es.close();
          currentEventSource = null;
          return;
        }
        let msg = "Export failed";
        const data = (ev as MessageEvent).data;
        if (typeof data === "string") {
          try {
            msg = (JSON.parse(data) as { message?: string }).message ?? msg;
            terminated = true;
          } catch {
            /* keep default */
          }
        } else if (es.readyState === EventSource.CLOSED) {
          msg = "Connection lost — please retry.";
        }
        setErrorMessage(msg);
        setPhase("error");
        es.close();
        currentEventSource = null;
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to start export"
      );
      setPhase("error");
    }
  }

  function resetToForm() {
    setPhase("form");
    setProgressDone(0);
    setProgressTotal(0);
    setErrorMessage(null);
  }

  function redownload(job: RecentJob) {
    if (!job.filename) return;
    triggerDownload(
      `/api/transactions/export/${job.id}/download`,
      job.filename
    );
  }

  return (
    <Modal
      variant="sheet"
      onClose={props.onClose}
      ariaLabel="Export transactions"
    >
      <div class="sm:w-[32rem] sm:max-w-[calc(100vw-2rem)] flex flex-col max-h-[88vh] text-ks-fg">
        <header class="px-5 sm:px-6 pt-5 pb-4 border-b border-ks-border/60">
          <p class="text-[10px] tracking-[0.3em] uppercase text-ks-accent font-semibold mb-0.5">
            Download
          </p>
          <h2 class="text-lg font-bold leading-tight">Export transactions</h2>
          <p class="text-xs text-ks-fg-muted mt-1 leading-relaxed">
            Pick a date range and we'll prepare a CSV in the background. Voided
            rows and transactions you don't have visibility on are excluded
            automatically.
          </p>
        </header>

        <div class="px-5 sm:px-6 py-4 space-y-5 overflow-x-hidden overflow-y-auto">
          <Show when={phase() === "form"}>
            <section class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-[10px] uppercase tracking-widest text-ks-fg-muted font-semibold mb-2">
                  Start date
                </label>
                <DatePicker
                  value={dateFrom()}
                  onChange={(d: string | null) => setDateFrom(d)}
                />
              </div>
              <div>
                <label class="block text-[10px] uppercase tracking-widest text-ks-fg-muted font-semibold mb-2">
                  End date
                </label>
                <DatePicker
                  value={dateTo()}
                  onChange={(d: string | null) => setDateTo(d)}
                />
              </div>
              <Show when={rangeError()}>
                <p class="col-span-2 -mt-1 text-xs text-ks-danger">
                  {rangeError()}
                </p>
              </Show>
            </section>

            <section class="rounded-lg border border-ks-border/60 bg-ks-surface/40 p-3">
              <label class="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consolidate()}
                  onChange={(e) => setConsolidate(e.currentTarget.checked)}
                  class="mt-0.5 h-4 w-4 rounded border-ks-border-strong bg-ks-surface text-ks-accent focus:ring-ks-accent"
                  data-testid="export-consolidate"
                />
                <span>
                  <span class="block text-sm font-semibold text-ks-fg">
                    Consolidate daily sales
                  </span>
                  <span class="block text-xs text-ks-fg-muted mt-0.5">
                    Roll every day's sales into one row (date, count, total).
                    Non-sale transactions are excluded from the file.
                  </span>
                </span>
              </label>
            </section>
          </Show>

          <Show when={phase() === "preparing"}>
            <section
              class="rounded-lg border border-ks-border/60 bg-ks-surface/40 p-4 space-y-3"
              data-testid="export-preparing"
            >
              <div class="flex items-center gap-2 text-ks-fg">
                <Loader2 size={16} class="animate-spin text-ks-accent" />
                <span class="text-sm font-semibold">Preparing your CSV…</span>
              </div>
              <div class="h-2 w-full overflow-hidden rounded-full bg-ks-surface-raised">
                <div
                  class="h-full bg-ks-accent transition-[width] duration-200"
                  style={{ width: `${progressPct()}%` }}
                />
              </div>
              <p class="text-xs text-ks-fg-muted tabular-nums">
                {progressDone().toLocaleString()}
                {progressTotal() > 0
                  ? ` of ${progressTotal().toLocaleString()}`
                  : ""}{" "}
                rows · {progressPct()}%
              </p>
            </section>
          </Show>

          <Show when={phase() === "done"}>
            <section
              class="rounded-lg border border-ks-success/30 bg-ks-success/5 p-4 space-y-2"
              data-testid="export-done"
            >
              <div class="flex items-center gap-2 text-ks-success">
                <CheckCircle2 size={16} />
                <span class="text-sm font-semibold">Download starting…</span>
              </div>
              <p class="text-xs text-ks-fg-muted leading-relaxed">
                If the download didn't start, use the matching entry in "Recent
                exports" below to grab it directly. We'll keep the file ready
                for 24 hours.
              </p>
            </section>
          </Show>

          <Show when={phase() === "error"}>
            <section
              class="rounded-lg border border-ks-danger/30 bg-ks-danger/5 p-4 space-y-2"
              data-testid="export-error"
            >
              <div class="flex items-center gap-2 text-ks-danger">
                <AlertCircle size={16} />
                <span class="text-sm font-semibold">Export failed</span>
              </div>
              <p class="text-xs text-ks-fg-muted">
                {errorMessage() ?? "Something went wrong."}
              </p>
            </section>
          </Show>

          <Show when={(recent() ?? []).length > 0}>
            <section>
              <div class="flex items-center justify-between mb-2">
                <h3 class="text-[10px] uppercase tracking-widest text-ks-fg-muted font-semibold">
                  Recent exports
                </h3>
                <span class="text-[10px] text-ks-fg-subtle">
                  Available for 24 hours
                </span>
              </div>
              <ul class="space-y-1.5">
                <For each={recent() ?? []}>
                  {(job) => (
                    <li class="flex items-center justify-between gap-2 rounded-md border border-ks-border/60 bg-ks-surface/40 px-3 py-2">
                      <div class="min-w-0 flex-1">
                        <div class="text-xs font-semibold text-ks-fg truncate">
                          {job.date_from} → {job.date_to}
                          {job.consolidate ? " · daily sales" : ""}
                        </div>
                        <div class="text-[10px] text-ks-fg-muted mt-0.5 flex items-center gap-2">
                          <Show when={job.status === "done"}>
                            <span>
                              {job.row_count?.toLocaleString() ?? 0} rows
                            </span>
                            <span>·</span>
                            <span>{formatBytes(job.byte_size)}</span>
                            <span>·</span>
                          </Show>
                          <Show
                            when={
                              job.status === "running" ||
                              job.status === "pending"
                            }
                          >
                            <Loader2
                              size={10}
                              class="animate-spin text-ks-accent inline"
                            />
                            <span>preparing…</span>
                            <span>·</span>
                          </Show>
                          <Show when={job.status === "error"}>
                            <AlertCircle
                              size={10}
                              class="text-ks-danger inline"
                            />
                            <span>failed</span>
                            <span>·</span>
                          </Show>
                          <span>{formatTimeAgo(job.created_at)}</span>
                        </div>
                      </div>
                      <Show when={job.status === "done" && job.filename}>
                        <button
                          type="button"
                          onClick={() => redownload(job)}
                          class="ks-interactive rounded-md border border-ks-border-strong bg-ks-surface px-2.5 py-1 text-[10px] uppercase tracking-widest text-ks-fg hover:border-ks-border-strong flex items-center gap-1"
                          data-testid="export-redownload"
                        >
                          <Download size={11} />
                          <span>Download</span>
                        </button>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </Show>
        </div>

        <footer class="px-5 sm:px-6 py-4 border-t border-ks-border/60 flex items-center justify-end gap-2">
          <Show when={phase() === "form"}>
            <Button intent="secondary" variant="ghost" onClick={props.onClose}>
              Cancel
            </Button>
            <Button
              intent="primary"
              variant="clip1"
              icon={Download}
              onClick={handlePrepare}
              disabled={!canPrepare()}
              data-testid="export-prepare"
            >
              Prepare CSV
            </Button>
          </Show>
          <Show when={phase() === "preparing"}>
            <Button intent="secondary" variant="ghost" onClick={props.onClose}>
              Run in background
            </Button>
          </Show>
          <Show when={phase() === "done" || phase() === "error"}>
            <Button intent="secondary" variant="ghost" onClick={resetToForm}>
              Export another
            </Button>
            <Button intent="primary" variant="clip1" onClick={props.onClose}>
              Done
            </Button>
          </Show>
        </footer>
      </div>
    </Modal>
  );
}
