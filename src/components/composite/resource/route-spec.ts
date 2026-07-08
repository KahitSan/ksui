// Pure builder layer for declarative resource routes. defineRoute() composes a
// frozen RouteSpec out of small helpers; the adapter (./route-adapter) folds it
// DOWN to the existing ResourceUiSpec, so ResourcePage stays the one render
// engine. No solid-js — this module is data only, like ./spec.ts.
import type { ColumnTone, UiColumnRender, UiFilter, UiDetailRow } from "./spec.js";
import type { FormSpec } from "./form-spec.js";

// ---- columns ---------------------------------------------------------------

/** A column descriptor; `render` is the EXISTING UiColumnRender union, so
 *  no new cell-rendering path is introduced. */
export interface RouteColumn {
  readonly key: string;
  readonly title: string;
  readonly orderable?: boolean;
  readonly render: UiColumnRender;
}

// Cell.* helpers emit the existing UiColumnRender union — the title field is the
// column key, supplied at col() time, so these only carry the render shape.
export const Cell = {
  Title: { type: "title" } as const satisfies UiColumnRender,
  Enum: (labels: Readonly<Record<string, string>>): UiColumnRender => ({ type: "enum", labels }),
  Status: (opts: {
    active: { label: string; tone: ColumnTone };
    inactive: { label: string; tone: ColumnTone };
  }): UiColumnRender => ({ type: "status", active: opts.active, inactive: opts.inactive }),
  Text: (opts?: { muted?: boolean }): UiColumnRender =>
    opts?.muted === undefined ? { type: "text" } : { type: "text", muted: opts.muted },
} as const;

/** Build a column. `orderable` is omitted (not set false) when not requested so
 *  the lowered spec matches a hand-authored one that left it out. */
export function col(
  key: string,
  opts: { title: string; orderable?: boolean; render: UiColumnRender },
): RouteColumn {
  const c: RouteColumn =
    opts.orderable === undefined
      ? { key, title: opts.title, render: opts.render }
      : { key, title: opts.title, orderable: opts.orderable, render: opts.render };
  return Object.freeze(c);
}

// ---- body views ------------------------------------------------------------

/** A `table` body. `kind` keys a future body-renderer registry; today only
 *  `table` is wired (the adapter THROWS on anything else). `cards` is reserved
 *  in the union but the builder for it is intentionally absent so an unwired
 *  view is a tsc error at the call site, not a runtime hole. */
export interface TableView {
  readonly kind: "table";
  readonly columns: readonly RouteColumn[];
}
export interface CardsView {
  readonly kind: "cards";
  readonly item: unknown;
}
export type BodyView = TableView | CardsView;

/** The only wired body builder. */
export function table(opts: { columns: readonly RouteColumn[] }): TableView {
  return Object.freeze({ kind: "table", columns: opts.columns });
}

// ---- header actions ---------------------------------------------------------

/** A header action. `flow` is a STRING id (never an inline fn) so a flow
 *  runtime can slot in behind a host-provided runner without recontracting. */
export interface RouteAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly variant?: string;
  readonly flow: string;
}
export function action(
  id: string,
  opts: { label: string; icon?: string; variant?: string; flow: string },
): RouteAction {
  return Object.freeze({
    id,
    label: opts.label,
    flow: opts.flow,
    ...(opts.icon ? { icon: opts.icon } : {}),
    ...(opts.variant ? { variant: opts.variant } : {}),
  });
}

// ---- the route spec ---------------------------------------------------------

export interface RoutePermissions {
  readonly view: string;
  readonly edit: readonly string[];
  readonly delete: string;
}

/** Labels carried straight onto the lowered ResourceUiSpec.labels. */
export type RouteLabels = {
  readonly add: string;
  readonly createTitle: string;
  readonly createSubmit: string;
  readonly editTitle: string;
  readonly editSubmit: string;
  readonly titleField: string;
  readonly searchPlaceholder: string;
  readonly empty: string;
  readonly noResults: string;
  readonly createErrorFallback: string;
  readonly updateErrorFallback: string;
  readonly networkError: string;
  readonly archiveTitle: string;
  readonly archiveMessage: string;
  readonly archiveConfirm: string;
};

/** A route-load setting. Reserved for a host settings store; the adapter does
 *  not lower it (it is host-resolved later), so it is presentation metadata
 *  only for now. */
export interface SettingDecl {
  readonly kind: "number";
  readonly default: number;
}
export const setting = {
  number: (opts: { default: number }): SettingDecl =>
    Object.freeze({ kind: "number", default: opts.default }),
} as const;

export interface RouteSpec {
  readonly path?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: string;
  readonly basePath: string;
  readonly softDeleteField: string;
  readonly testIdPrefix: string;
  readonly permissions: RoutePermissions;
  readonly header?: { readonly actions: readonly RouteAction[] };
  readonly toolbar?: {
    readonly search?: { readonly placeholder: string; readonly fields: readonly string[] };
    readonly filters?: readonly UiFilter[];
  };
  readonly view:
    | BodyView
    | { readonly views: Readonly<Record<string, BodyView>>; readonly default: string };
  readonly form?: FormSpec;
  readonly detail: readonly UiDetailRow[];
  readonly settings?: Readonly<Record<string, SettingDecl>>;
  // Sticky-footer slot — reserved in the contract, not rendered yet (needs an
  // additive page-shell `footer?` prop on the consumer side).
  readonly footer?: unknown;
  readonly labels: RouteLabels;
}

/** defineRoute composes a frozen RouteSpec. Pure — no rendering, no side effects. */
export function defineRoute(cfg: RouteSpec): RouteSpec {
  return Object.freeze(cfg);
}
