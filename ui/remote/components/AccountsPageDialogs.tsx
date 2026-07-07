import { Show, type Accessor } from "solid-js";
import { Modal, Button } from "@kahitsan/ksui";
import X from "lucide-solid/icons/x";
import AlertTriangle from "lucide-solid/icons/triangle-alert";
import { type FinancialAccount, TYPE_LABELS, formatCurrency } from "../lib/accounts.js";

// Extracted from AccountsPage.tsx to keep the primary page file under the
// 1000-LOC budget (check-loc-budget.sh). Both dialogs remain fully controlled
// by the parent's signals (rename buffer + confirm/busy state) so behaviour is
// byte-identical to the pre-extraction inline blocks; this is a pure move, no
// re-architecture.

interface RenameAccountDialogProps {
  target: Accessor<FinancialAccount | null>;
  name: Accessor<string>;
  setName: (v: string) => void;
  error: Accessor<string>;
  saving: Accessor<boolean>;
  onClose: () => void;
  onSubmit: () => void;
}

export function RenameAccountDialog(props: RenameAccountDialogProps) {
  return (
    <Show when={props.target()}>
      {(_target) => (
        <Modal onClose={props.onClose} size="sm">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold text-zinc-100">Rename Account</h2>
            <button
              onClick={props.onClose}
              class="text-zinc-500 hover:text-zinc-300 cursor-pointer"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              props.onSubmit();
            }}
            class="space-y-4"
          >
            <Show when={props.error()}>
              <div class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {props.error()}
              </div>
            </Show>
            <div>
              <label class="block text-xs text-zinc-500 mb-1">Name</label>
              <input
                type="text"
                value={props.name()}
                onInput={(e) => props.setName(e.target.value)}
                class="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500/50 focus:outline-none"
                autofocus
                required
              />
            </div>
            <div class="flex justify-end gap-3">
              <Button
                intent="secondary"
                variant="ghost"
                onClick={props.onClose}
                disabled={props.saving()}
              >
                Cancel
              </Button>
              <Button
                intent="primary"
                variant="clip1"
                disabled={props.saving()}
                onClick={props.onSubmit}
              >
                {props.saving() ? "Saving..." : "Rename"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </Show>
  );
}

interface ArchiveAccountDialogProps {
  target: Accessor<FinancialAccount | null>;
  busy: Accessor<boolean>;
  onClose: () => void;
  onConfirm: () => void;
}

export function ArchiveAccountDialog(props: ArchiveAccountDialogProps) {
  return (
    <Show when={props.target()}>
      {(target) => (
        <Modal
          onClose={() => !props.busy() && props.onClose()}
          size="md"
          tone="danger"
        >
          <div class="flex items-start gap-3 mb-4">
            <AlertTriangle size={22} class="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <h2 class="text-lg font-semibold text-white">Archive this account?</h2>
              <p class="text-xs text-zinc-400 mt-1">
                The account will be hidden from the active list. You can restore it
                later from the archived tab.
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
              disabled={props.busy()}
              onClick={props.onClose}
              class="flex-1"
            >
              Cancel
            </Button>
            <Button
              intent="danger"
              variant="clip1"
              data-testid="accounts-confirm-archive-btn"
              disabled={props.busy()}
              onClick={props.onConfirm}
              class="flex-1"
            >
              {props.busy() ? "Archiving..." : "Archive"}
            </Button>
          </div>
        </Modal>
      )}
    </Show>
  );
}
