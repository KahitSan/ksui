// The advanced-fields container of the transaction create/edit form: the Tax
// type 4-way toggle + VAT breakdown preview, the EWT checkbox/rate/preview, and
// the full Private-transaction panel (toggle, share-with-role buttons, per-member
// checkbox list). Carved verbatim out of TransactionForm; the form still owns the
// `viewMode === "advanced"` <Show> gate, so toggle behavior is unchanged. Props
// are a verbatim subset of TransactionFormProps.

import { For, Show } from "solid-js";
import Lock from "lucide-solid/icons/lock";
import FormField from "../base/FormField";
import SegmentedFilter from "../base/SegmentedFilter";
import { formatPHP } from "../../utils/formatPHP";
import type { TransactionOrgMember, TransactionShareableRole } from "./TransactionForm";

export interface FormAdvancedSectionProps {
  amount: string;
  category: string;
  taxType: string;
  setTaxType: (v: string) => void;
  hasEwt: boolean;
  setHasEwt: (v: boolean) => void;
  ewtRate: string;
  setEwtRate: (v: string) => void;
  isPrivate: boolean;
  setIsPrivate: (v: boolean) => void;
  sharedWith: string[];
  setSharedWith: (v: string[]) => void;
  sharedRoleCodes: string[];
  setSharedRoleCodes: (v: string[]) => void;
  orgMembers: TransactionOrgMember[];
  shareableRoles: TransactionShareableRole[];
  canShare: boolean;
}

export default function FormAdvancedSection(props: FormAdvancedSectionProps) {
  return (
    <div
      data-testid="advanced-fields-container"
      class="rounded-lg border border-[color-mix(in_srgb,var(--ks-border-strong,#3f3f46)_60%,transparent)] bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_40%,transparent)] p-3 space-y-3"
    >
      <div class="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--ks-fg-muted,#a1a1aa)] font-semibold">
        <span>Advanced</span>
      </div>

      <div class="rounded-lg border border-[color-mix(in_srgb,var(--ks-border-strong,#3f3f46)_50%,transparent)] bg-[color-mix(in_srgb,var(--ks-bg,#0a0a0a)_40%,transparent)] p-3">
        <FormField label="Tax">
          <SegmentedFilter
            options={[
              { value: "vat_inclusive", label: "VAT Incl." },
              { value: "vat_exclusive", label: "VAT Excl." },
              { value: "vat_exempt", label: "Exempt" },
              { value: "non_vat", label: "Non-VAT" },
            ]}
            value={props.taxType}
            onChange={props.setTaxType}
          />
        </FormField>
        <Show
          when={
            props.amount &&
            parseFloat(props.amount) > 0 &&
            (props.taxType === "vat_inclusive" ||
              props.taxType === "vat_exclusive")
          }
        >
          {(() => {
            const amt = parseFloat(props.amount);
            const sub =
              props.taxType === "vat_inclusive"
                ? Math.round((amt / 1.12) * 100) / 100
                : amt;
            const vat =
              props.taxType === "vat_inclusive"
                ? Math.round((amt - sub) * 100) / 100
                : Math.round(amt * 0.12 * 100) / 100;
            const total = props.taxType === "vat_exclusive" ? sub + vat : amt;
            return (
              <div class="mt-2 text-xs text-[var(--ks-fg-subtle,#71717a)] space-y-0.5 border-t border-zinc-800/50 pt-2">
                <div class="flex justify-between">
                  <span>VATtable Sales</span>
                  <span>{formatPHP(sub)}</span>
                </div>
                <div class="flex justify-between">
                  <span>VAT (12%)</span>
                  <span>{formatPHP(vat)}</span>
                </div>
                <div class="flex justify-between font-medium text-[var(--ks-fg-muted,#a1a1aa)]">
                  <span>Total</span>
                  <span>{formatPHP(total)}</span>
                </div>
              </div>
            );
          })()}
        </Show>

        <Show
          when={props.category === "expense" || props.category === "payable"}
        >
          <div class="mt-3 border-t border-[color-mix(in_srgb,var(--ks-border-strong,#3f3f46)_50%,transparent)] pt-3">
            <label class="flex items-center gap-2 text-xs text-[var(--ks-fg-muted,#a1a1aa)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={props.hasEwt}
                onChange={(e) => props.setHasEwt(e.currentTarget.checked)}
                class="h-4 w-4 accent-[var(--ks-primary,#c9a961)] cursor-pointer"
              />
              <span>Has Expanded Withholding Tax</span>
            </label>
            <Show when={props.hasEwt}>
              <div class="mt-2 space-y-2">
                <FormField label="EWT rate (%)">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="100"
                    value={props.ewtRate}
                    onInput={(e) => props.setEwtRate(e.currentTarget.value)}
                    class="w-full px-3 py-2 bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_50%,transparent)] border border-[var(--ks-border-strong,#3f3f46)] text-[var(--ks-fg,#ffffff)] text-sm rounded-md focus:outline-none focus:border-[color-mix(in_srgb,var(--ks-primary,#c9a961)_50%,transparent)]"
                    placeholder="e.g. 1, 2, 5, 10, 15"
                  />
                </FormField>
                <Show
                  when={
                    props.amount &&
                    parseFloat(props.amount) > 0 &&
                    props.ewtRate &&
                    parseFloat(props.ewtRate) > 0
                  }
                >
                  {(() => {
                    const amt = parseFloat(props.amount);
                    const rate = parseFloat(props.ewtRate);
                    const ewt = Math.round(amt * rate) / 100;
                    return (
                      <div class="text-xs text-[var(--ks-fg-subtle,#71717a)] border-t border-[color-mix(in_srgb,var(--ks-border-strong,#3f3f46)_50%,transparent)] pt-2">
                        <div class="flex justify-between">
                          <span>EWT ({rate}%)</span>
                          <span>{formatPHP(ewt)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      <div
        class="rounded-lg border border-[color-mix(in_srgb,var(--ks-border-strong,#3f3f46)_50%,transparent)] bg-[color-mix(in_srgb,var(--ks-bg,#0a0a0a)_40%,transparent)] p-4 relative"
        classList={{ "opacity-60": !props.canShare }}
        title={
          props.canShare
            ? undefined
            : "Sharing private transactions requires the members.list_basic permission."
        }
      >
        <div class="flex items-center justify-between min-h-[44px]">
          <div class="flex items-center gap-2">
            <Lock size={14} class="text-[var(--ks-fg-subtle,#71717a)]" />
            <div>
              <span class="text-sm text-[var(--ks-fg-muted,#a1a1aa)]">Private transaction</span>
              <p class="text-[10px] text-[var(--ks-fg-subtle,#71717a)]">
                {props.canShare
                  ? "Hidden from others unless shared"
                  : "Locked — needs members.list_basic permission"}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={!props.canShare}
            aria-label="Toggle private transaction"
            onClick={() => {
              if (!props.canShare) return;
              props.setIsPrivate(!props.isPrivate);
            }}
            class="ks-theme-toggle shrink-0"
            classList={{ "cursor-not-allowed": !props.canShare }}
          >
            <span
              class="ks-theme-toggle-track"
              data-active={props.isPrivate ? "" : undefined}
            >
              <span class="ks-theme-toggle-icon ks-theme-toggle-icon-moon">
                <Lock size={12} />
              </span>
              <span class="ks-theme-toggle-icon ks-theme-toggle-icon-sun">
                <Lock size={12} />
              </span>
            </span>
          </button>
        </div>

        <Show when={props.isPrivate && props.canShare}>
          <div class="mt-4 pt-3 border-t border-[color-mix(in_srgb,var(--ks-border-strong,#3f3f46)_50%,transparent)]">
            <p class="text-[10px] text-[var(--ks-fg-subtle,#71717a)] mb-3">
              Always visible to:{" "}
              <span class="text-[var(--ks-fg-muted,#a1a1aa)]">
                you (creator), org admins, superusers
              </span>
            </p>

            <span class="text-xs text-[var(--ks-fg-subtle,#71717a)] block mb-2">
              Share with role
            </span>
            <div class="flex gap-2 mb-3 flex-wrap">
              <For each={props.shareableRoles}>
                {(role) => {
                  const members = () =>
                    Array.isArray(props.orgMembers) ? props.orgMembers : [];
                  const membersInRole = () =>
                    members().filter((m) => m.role === role.code);
                  const selected = () =>
                    props.sharedRoleCodes.includes(role.code);
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        if (selected()) {
                          props.setSharedRoleCodes(
                            props.sharedRoleCodes.filter((c) => c !== role.code)
                          );
                        } else {
                          const roleMemberIds = membersInRole().map(
                            (m) => m.user_id
                          );
                          props.setSharedWith(
                            props.sharedWith.filter(
                              (id) => !roleMemberIds.includes(id)
                            )
                          );
                          props.setSharedRoleCodes([
                            ...props.sharedRoleCodes,
                            role.code,
                          ]);
                        }
                      }}
                      class="px-3 py-2 text-xs rounded-lg border cursor-pointer min-h-[36px] capitalize transition-colors active:opacity-80"
                      classList={{
                        "border-[color-mix(in_srgb,var(--ks-primary,#c9a961)_40%,transparent)] bg-[color-mix(in_srgb,var(--ks-primary,#c9a961)_10%,transparent)] text-[var(--ks-accent,#fbbf24)]":
                          selected(),
                        "border-[var(--ks-border-strong,#3f3f46)] bg-[color-mix(in_srgb,var(--ks-surface-raised,#1a1a1a)_50%,transparent)] text-[var(--ks-fg-muted,#a1a1aa)] hover:border-[var(--ks-border-strong,#3f3f46)]":
                          !selected(),
                      }}
                    >
                      All {role.label}s
                      <Show when={membersInRole().length > 0}>
                        <span class="text-[var(--ks-fg-subtle,#71717a)] ml-1">
                          ({membersInRole().length})
                        </span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>

            <span class="text-xs text-[var(--ks-fg-subtle,#71717a)] block mb-2">
              Or select people
            </span>
            <div class="space-y-0.5 max-h-[150px] overflow-y-auto">
              <For
                each={(Array.isArray(props.orgMembers)
                  ? props.orgMembers
                  : []
                ).filter((m) => m.role !== "admin")}
              >
                {(m) => {
                  const coveringRole = () =>
                    props.shareableRoles.find(
                      (r) =>
                        r.code === m.role &&
                        props.sharedRoleCodes.includes(r.code)
                    );
                  const checked = () =>
                    props.sharedWith.includes(m.user_id) || !!coveringRole();
                  return (
                    <label
                      class="flex items-center gap-3 text-sm py-2 px-2 rounded-lg min-h-[40px] transition-colors"
                      classList={{
                        "text-[var(--ks-fg-muted,#a1a1aa)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--ks-surface-raised,#1a1a1a)_30%,transparent)] active:bg-[color-mix(in_srgb,var(--ks-surface-raised,#1a1a1a)_50%,transparent)]":
                          !coveringRole(),
                        "text-[var(--ks-fg-subtle,#71717a)] cursor-not-allowed bg-[color-mix(in_srgb,var(--ks-overlay-surface,#18181b)_40%,transparent)]":
                          !!coveringRole(),
                      }}
                    >
                      <div
                        class="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors"
                        classList={{
                          "border-[var(--ks-primary,#c9a961)] bg-[var(--ks-primary,#c9a961)]":
                            checked() && !coveringRole(),
                          "border-[color-mix(in_srgb,var(--ks-primary,#c9a961)_40%,transparent)] bg-[color-mix(in_srgb,var(--ks-primary,#c9a961)_40%,transparent)]":
                            checked() && !!coveringRole(),
                          "border-[var(--ks-border-strong,#3f3f46)] bg-transparent": !checked(),
                        }}
                      >
                        <Show when={checked()}>
                          <svg
                            class="w-3 h-3 text-[var(--ks-fg-on-primary,#0a0a0a)]"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            stroke-width="3"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </Show>
                      </div>
                      <input
                        type="checkbox"
                        checked={checked()}
                        disabled={!!coveringRole()}
                        onChange={(e) => {
                          if (coveringRole()) return;
                          if (e.target.checked) {
                            props.setSharedWith([
                              ...props.sharedWith,
                              m.user_id,
                            ]);
                          } else {
                            props.setSharedWith(
                              props.sharedWith.filter((id) => id !== m.user_id)
                            );
                          }
                        }}
                        class="sr-only"
                      />
                      <span class="flex-1">{m.name}</span>
                      <Show
                        when={coveringRole()}
                        fallback={
                          <span class="text-[10px] text-[var(--ks-fg-subtle,#71717a)] capitalize">
                            {m.role}
                          </span>
                        }
                      >
                        <span class="text-[10px] text-[color-mix(in_srgb,var(--ks-primary,#c9a961)_70%,transparent)]">
                          via All {coveringRole()!.label}s
                        </span>
                      </Show>
                    </label>
                  );
                }}
              </For>
              <Show
                when={
                  !Array.isArray(props.orgMembers) ||
                  props.orgMembers.length === 0
                }
              >
                <p class="text-xs text-[var(--ks-fg-subtle,#71717a)] py-2">Loading members...</p>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
