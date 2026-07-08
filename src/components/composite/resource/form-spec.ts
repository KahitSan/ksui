// Pure builder for a declarative form descriptor. field.* helpers compile DOWN
// to the EXISTING UiField union, so ResourceForm renders them with zero new
// path. defineForm(...).fields plugs straight into the route adapter as
// spec.fields. No solid-js — data only.
import type { FieldTransform, UiField, UiFieldSelectOption } from "./spec.js";

// ---- field defs ------------------------------------------------------------

// FieldDef carries the lowered UiField body minus the key (supplied at the
// fields-record key) and label (supplied per builder). `kind` is the discriminant.
export interface FieldDefText {
  readonly kind: "text";
  readonly label: string;
  readonly required?: boolean;
  readonly transform: FieldTransform;
  readonly placeholder?: string;
}
export interface FieldDefTextarea {
  readonly kind: "textarea";
  readonly label: string;
  readonly required?: boolean;
  readonly transform: FieldTransform;
  readonly placeholder?: string;
  readonly rows?: number;
}
export interface FieldDefSelect {
  readonly kind: "select";
  readonly label: string;
  readonly required?: boolean;
  readonly default?: string;
  readonly options: readonly UiFieldSelectOption[];
}
// Declared-but-unwired kinds: present in the union so the contract is whole,
// but no field.* builder produces them — an unwired kind is a tsc error at the
// call site, never a silent runtime hole (the adapter also throws on it).
export interface FieldDefUnwired {
  readonly kind: "currency" | "date" | "relation" | "file";
  readonly label: string;
}
export type FieldDef = FieldDefText | FieldDefTextarea | FieldDefSelect | FieldDefUnwired;

export const field = {
  text: (opts: {
    label: string;
    required?: boolean;
    transform: FieldTransform;
    placeholder?: string;
  }): FieldDefText =>
    Object.freeze({
      kind: "text",
      label: opts.label,
      transform: opts.transform,
      ...(opts.required ? { required: opts.required } : {}),
      ...(opts.placeholder !== undefined ? { placeholder: opts.placeholder } : {}),
    }),
  textarea: (opts: {
    label: string;
    required?: boolean;
    transform: FieldTransform;
    placeholder?: string;
    rows?: number;
  }): FieldDefTextarea =>
    Object.freeze({
      kind: "textarea",
      label: opts.label,
      transform: opts.transform,
      ...(opts.required ? { required: opts.required } : {}),
      ...(opts.rows !== undefined ? { rows: opts.rows } : {}),
      ...(opts.placeholder !== undefined ? { placeholder: opts.placeholder } : {}),
    }),
  select: (opts: {
    label: string;
    required?: boolean;
    default?: string;
    options: readonly UiFieldSelectOption[];
  }): FieldDefSelect =>
    Object.freeze({
      kind: "select",
      label: opts.label,
      options: opts.options,
      ...(opts.default !== undefined ? { default: opts.default } : {}),
      ...(opts.required ? { required: opts.required } : {}),
    }),
} as const;

// ---- the form spec ---------------------------------------------------------

export interface FormSpec {
  readonly name?: string;
  readonly title?: string;
  readonly fields: Readonly<Record<string, FieldDef>>;
  // Binding seam: STRING command ids, not hardcoded verbs, so a flow runtime
  // can slot in without recontracting the form.
  readonly submit: { readonly create?: string; readonly update?: string; readonly label?: string };
  readonly layout?: unknown;
}

export function defineForm(cfg: FormSpec): FormSpec {
  return Object.freeze(cfg);
}

// ---- lowering (consumed by ./route-adapter) ---------------------------------

/** Fold one FieldDef + its key into the existing UiField. THROWS on an
 *  unwired kind so the wired subset fails loudly at build/test. */
export function fieldToUiField(key: string, def: FieldDef): UiField {
  switch (def.kind) {
    case "text":
      return {
        key,
        label: def.label,
        type: "text",
        ...(def.required ? { required: def.required } : {}),
        transform: def.transform,
        ...(def.placeholder !== undefined ? { placeholder: def.placeholder } : {}),
      };
    case "textarea":
      return {
        key,
        label: def.label,
        type: "textarea",
        ...(def.required ? { required: def.required } : {}),
        transform: def.transform,
        ...(def.rows !== undefined ? { rows: def.rows } : {}),
        ...(def.placeholder !== undefined ? { placeholder: def.placeholder } : {}),
      };
    case "select":
      return {
        key,
        label: def.label,
        type: "select",
        ...(def.default !== undefined ? { default: def.default } : {}),
        options: def.options,
        ...(def.required ? { required: def.required } : {}),
      };
    default:
      throw new Error(
        `form-spec: field "${key}" uses unwired kind "${(def as { kind: string }).kind}" (only text/textarea/select are wired)`,
      );
  }
}
