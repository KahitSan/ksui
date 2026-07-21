import { Show, type Accessor } from "solid-js";
import X from "lucide-solid/icons/x";
import Archive from "lucide-solid/icons/archive";
import ArchiveRestore from "lucide-solid/icons/archive-restore";
import Pencil from "lucide-solid/icons/pencil";
import { type FinancialAccount } from "../lib/accounts";

export function AccountDetailModalHeader(props: {
  account: Accessor<FinancialAccount | null>;
  editing: Accessor<boolean>;
  isAdmin: Accessor<boolean>;
  onEdit: () => void;
  onArchive: (account: FinancialAccount) => void;
  onRestore: (accountId: number) => void;
  onClose: () => void;
}) {
  return (
    <div
      data-testid="accounts-detail-modal"
      class="flex items-center justify-between mb-6"
    >
      <Show
        when={props.account()}
        fallback={
          <>
            <div class="h-6 w-40 animate-pulse rounded bg-ks-fg/5" />
            <CloseButton onClose={props.onClose} />
          </>
        }
      >
        {(account) => (
          <>
            <h2 class="text-lg font-semibold text-ks-fg">
              {props.editing() ? "Edit Account" : account().name}
            </h2>
            <div class="flex items-center gap-2">
              <Show when={!props.editing() && props.isAdmin()}>
                <button
                  data-testid="accounts-edit-btn"
                  onClick={props.onEdit}
                  class="text-ks-fg-muted hover:text-ks-accent cursor-pointer p-1"
                  title="Edit"
                  aria-label="Edit account"
                >
                  <Pencil size={16} />
                </button>
              </Show>
              <Show when={!props.editing() && props.isAdmin()}>
                {account().is_active ? (
                  <button
                    data-testid="accounts-archive-btn"
                    onClick={() => props.onArchive(account())}
                    class="text-ks-fg-muted hover:text-ks-danger cursor-pointer p-1"
                    title="Archive"
                    aria-label="Archive account"
                  >
                    <Archive size={16} />
                  </button>
                ) : (
                  <button
                    data-testid="accounts-restore-btn"
                    onClick={() => props.onRestore(account().id)}
                    class="text-ks-fg-muted hover:text-ks-success cursor-pointer p-1"
                    title="Restore"
                    aria-label="Restore account"
                  >
                    <ArchiveRestore size={16} />
                  </button>
                )}
              </Show>
              <CloseButton onClose={props.onClose} />
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

function CloseButton(props: { onClose: () => void }) {
  return (
    <button
      data-testid="accounts-detail-close"
      onClick={props.onClose}
      class="text-ks-fg-muted hover:text-ks-fg cursor-pointer p-1"
      aria-label="Close"
    >
      <X size={20} />
    </button>
  );
}
