// Spec-driven default-datatable UI runtime — the declarative contract + its PURE
// helpers (no solid-js / ksui imports, so it unit-tests under plain node).
//
// Phase 2 P1 (UI half): a base plugin's list/create/edit/archive page is the
// data-shaped projection of its resource. This module is the UI mirror of the
// server-side `defineResource(spec)` runtime (kernel-base/resource/*): the SAME
// field/column declarations that drive the table + migration + CRUD routes also
// drive the page. Authored once as a `ResourceUiSpec`, rendered by `ResourcePage`
// (ResourcePage.tsx) into the exact ksui DataTable + Modal + FormField shell a
// hand-written base plugin ships.
//
// Built inside kplugin_payees as the make-or-break proof (byte-for-behavior ==
// hand-written payees). It imports only ksui + @kserp/host-ui + solid-js, so it
// lifts into the shared SDK / UI-kit later (that lift needs the plugin UI build
// to resolve the SDK — a vite alias + tsconfig.ui paths entry — out of scope here).

/** A row the runtime can render: any record with a numeric surrogate id. */
export interface ResourceRow {
  id: number;
  [key: string]: unknown;
}

// ---- columns ---------------------------------------------------------------

export type ColumnTone = "success" | "warning" | "danger" | "neutral";

/** Plain text cell; renders `—` when the value is null/empty. `muted` dims it. */
export interface UiColumnText {
  readonly type: "text";
  readonly muted?: boolean;
}
/** The clickable title cell that opens the detail modal. */
export interface UiColumnTitle {
  readonly type: "title";
}
/** Enum value rendered through a label map (e.g. vendor → "Vendor"). */
export interface UiColumnEnum {
  readonly type: "enum";
  readonly labels: Readonly<Record<string, string>>;
}
/** A boolean column rendered as a ksui StatusPill (e.g. is_active → Active/Archived). */
export interface UiColumnStatus {
  readonly type: "status";
  readonly active: { readonly label: string; readonly tone: ColumnTone };
  readonly inactive: { readonly label: string; readonly tone: ColumnTone };
}
export type UiColumnRender = UiColumnText | UiColumnTitle | UiColumnEnum | UiColumnStatus;

export interface UiColumn {
  /** Row property this column reads (also the `data` key + sort field). */
  readonly key: string;
  readonly title: string;
  readonly orderable?: boolean;
  readonly render: UiColumnRender;
}

// ---- form fields -----------------------------------------------------------

/** How a submitted string field is coerced into the request body. */
export type FieldTransform = "trim" | "trimOrNull";

export interface UiFieldText {
  readonly type: "text";
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly transform: FieldTransform;
}
export interface UiFieldTextarea {
  readonly type: "textarea";
  readonly placeholder?: string;
  readonly rows?: number;
  readonly required?: boolean;
  readonly transform: FieldTransform;
}
export interface UiFieldSelectOption {
  readonly value: string;
  readonly label: string;
}
export interface UiFieldSelect {
  readonly type: "select";
  readonly options: readonly UiFieldSelectOption[];
  /** Default option value for a fresh create (defaults to the first option). */
  readonly default?: string;
  /**
   * Reject an empty selection (a select that opens on an empty placeholder
   * option). A select with a non-empty default never trips this; it matters
   * for a future spec whose first option is a `""` "Choose…" placeholder.
   */
  readonly required?: boolean;
}
export type UiField = { readonly key: string; readonly label: string } & (
  | UiFieldText
  | UiFieldTextarea
  | UiFieldSelect
);

// ---- filters ---------------------------------------------------------------

/** A segmented control whose value is ALWAYS sent as a query param. */
export interface UiFilterSegmented {
  readonly type: "segmented";
  readonly param: string;
  readonly options: readonly string[];
  readonly default: string;
  readonly testIdPrefix: string;
}
/** A native select whose value is sent only when non-empty (`""` = no filter). */
export interface UiFilterSelect {
  readonly type: "select";
  readonly param: string;
  readonly default: string;
  readonly options: readonly UiFieldSelectOption[];
}
export type UiFilter = UiFilterSegmented | UiFilterSelect;

// ---- detail view -----------------------------------------------------------

export type UiDetailValue =
  | { readonly type: "field"; readonly key: string }
  | { readonly type: "enum"; readonly key: string; readonly labels: Readonly<Record<string, string>> }
  | { readonly type: "status"; readonly key: string; readonly active: string; readonly inactive: string }
  | { readonly type: "datetime"; readonly key: string };

export interface UiDetailRow {
  readonly label: string;
  readonly value: UiDetailValue;
}

// ---- the spec --------------------------------------------------------------

export interface ResourceUiSpec {
  /** REST base, e.g. "/api/payees". CRUD endpoints derive from it. */
  readonly basePath: string;
  /** Page title + framing. */
  readonly title: string;
  readonly subtitle?: string;
  /** PageShareButton wiring. */
  readonly share?: { readonly module: string; readonly moduleLabel: string };
  /** Capability codes. `edit` is satisfied by hasAny(...edit). */
  readonly permissions: {
    readonly view: string;
    readonly edit: readonly string[];
    readonly delete: string;
  };
  /** Soft-delete boolean field; drives the archive/restore affordance + status. */
  readonly softDeleteField: string;
  readonly columns: readonly UiColumn[];
  readonly fields: readonly UiField[];
  readonly filters?: readonly UiFilter[];
  readonly detail: readonly UiDetailRow[];
  readonly labels: {
    readonly add: string;
    readonly createTitle: string;
    readonly createSubmit: string;
    readonly editTitle: string;
    readonly editSubmit: string;
    /** The detail-modal title falls back to this row field when not editing. */
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
  /** data-testid prefix (e.g. "payees" → payees-add-btn, payees-row-3). */
  readonly testIdPrefix: string;
}

// ---- derived endpoints -----------------------------------------------------

export interface ResourceEndpoints {
  readonly list: string;
  readonly create: string;
  readonly one: (id: number) => string;
  readonly restore: (id: number) => string;
}

export function endpoints(spec: ResourceUiSpec): ResourceEndpoints {
  const base = spec.basePath;
  return {
    list: base,
    create: base,
    one: (id) => `${base}/${id}`,
    restore: (id) => `${base}/${id}/restore`,
  };
}

// ---- pure helpers (unit-tested) --------------------------------------------

/** The fixed columns the list request always carries. */
export interface ListParams {
  readonly page: number;
  readonly limit: number;
  readonly search: string;
  readonly sortBy: string | null;
  readonly sortDir: string;
}

/**
 * Build the list-request query string. Mirrors hand-written payees exactly:
 * page/limit/search/sortBy/sortDir are always present; a segmented filter is
 * always sent; a select filter is sent only when its value is non-empty.
 */
export function buildListQuery(
  spec: ResourceUiSpec,
  params: ListParams,
  filterState: Readonly<Record<string, string>>,
): URLSearchParams {
  const q = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
    search: params.search,
    sortBy: params.sortBy || "",
    sortDir: params.sortDir,
  });
  for (const f of spec.filters ?? []) {
    const value = filterState[f.param] ?? f.default;
    // Segmented filters are always sent; a select filter only when non-empty.
    if (f.type === "segmented" || value) {
      q.set(f.param, value);
    }
  }
  return q;
}

/** The default filter state (each filter at its declared default). */
export function initialFilterState(spec: ResourceUiSpec): Record<string, string> {
  const state: Record<string, string> = {};
  for (const f of spec.filters ?? []) state[f.param] = f.default;
  return state;
}

/** The default option value for a select field (explicit default ?? first option). */
export function selectDefault(field: UiFieldSelect): string {
  return field.default ?? field.options[0]?.value ?? "";
}

/** A fresh, empty form: "" for text/textarea, the default option for a select. */
export function emptyFormValues(spec: ResourceUiSpec): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of spec.fields) {
    values[f.key] = f.type === "select" ? selectDefault(f) : "";
  }
  return values;
}

/** Prefill the form from an existing row (edit mode). */
export function rowToFormValues(
  spec: ResourceUiSpec,
  row: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = row[f.key];
    values[f.key] = v === null || v === undefined ? "" : String(v);
  }
  return values;
}

/** Strip a trailing required-marker (" *") from a field label. */
export function cleanLabel(label: string): string {
  const trimmed = label.trimEnd();
  return (trimmed.endsWith("*") ? trimmed.slice(0, -1) : trimmed).trimEnd();
}

/**
 * Validate the form. Returns the first required-but-empty field's error message,
 * or null when valid. Matches payees' "Name is required" exactly.
 */
export function validateForm(
  spec: ResourceUiSpec,
  values: Readonly<Record<string, string>>,
): string | null {
  for (const f of spec.fields) {
    // text/textarea/select all carry an optional `required`; a select with a
    // non-empty default never trips this, but a placeholder-first select can.
    if (f.required && !(values[f.key] ?? "").trim()) {
      return `${cleanLabel(f.label)} is required`;
    }
  }
  return null;
}

/** Coerce form values into the request body per each field's transform. */
export function formToBody(
  spec: ResourceUiSpec,
  values: Readonly<Record<string, string>>,
): Record<string, string | null> {
  const body: Record<string, string | null> = {};
  for (const f of spec.fields) {
    const raw = values[f.key] ?? "";
    if (f.type === "select") {
      body[f.key] = raw;
    } else if (f.transform === "trim") {
      body[f.key] = raw.trim();
    } else {
      body[f.key] = raw.trim() || null;
    }
  }
  return body;
}
