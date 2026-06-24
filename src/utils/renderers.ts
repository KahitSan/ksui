// U8 — schema-bound custom renderer registry (Vision §8).
//
// A custom renderer is a REAL, in-process SolidJS component built on ksui
// primitives — never an iframe/VM. The Vision is explicit that runtime isolation
// is deliberately omitted (theming fidelity + performance); what keeps a renderer
// safe is that it holds NO authority: it receives only its declared `consumes`
// data and can only fire its declared `emits` (flow triggers, §9). It cannot read
// or write data or call peers.
//
// WHY a build-time, in-process registry (no eval, no remote code): the security
// boundary for code-bearing UI is SUPPLY-CHAIN, not sandbox (Vision §8 / §14 —
// the VS Code model). The registry holds only components linked into the bundle
// at build time, so trust comes from the package supply chain (signing, scanning,
// verified publishers), not from caging a string of code at runtime. There is no
// `eval`, no dynamic `import(url)`, no Function constructor anywhere here.

import type { Component } from "solid-js";

/** The set of primitive shapes a renderer can declare it consumes per field. */
export type ConsumeKind =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "array"
  | "object"
  | "currency"
  | "any";

/**
 * The input-schema contract a renderer declares (§8 `consumes`): a map of
 * prop name → expected kind. A trailing "?" on the kind marks the field optional
 * (e.g. `balance: "currency?"` in the Vision example). The registry validates an
 * `item` against this before rendering and falls back when it doesn't match.
 */
export type ConsumesSchema = Readonly<Record<string, `${ConsumeKind}` | `${ConsumeKind}?`>>;

/** The props a registered renderer receives. `emit` only fires declared triggers. */
export interface RendererProps {
  /** The validated data object, shaped by the renderer's `consumes` schema. */
  readonly item: Record<string, unknown>;
  /**
   * Fire one of the renderer's declared `emits` interaction points. The host
   * wires each emit name to a flow trigger (§9); ksui never executes authority.
   * An emit NOT in the declared set is dropped with a warning (a renderer cannot
   * forge an interaction it never declared).
   */
  readonly emit: (event: string, payload?: unknown) => void;
}

/** A registry entry: the schema-bound contract plus the in-process component. */
export interface RendererDefinition {
  /** Stable id a spec binds to (e.g. "availment-card"). */
  readonly id: string;
  /** Input schema the component consumes (§8). */
  readonly consumes: ConsumesSchema;
  /** Interaction points the component may emit (§8) → flow triggers (§9). */
  readonly emits: readonly string[];
  /** The real, in-process SolidJS component. Built on ksui primitives. */
  readonly render: Component<RendererProps>;
}

/** Result of validating an item against a `consumes` schema. */
export interface ValidationResult {
  readonly ok: boolean;
  /** Human-readable reasons a prop failed (empty when ok). */
  readonly errors: readonly string[];
}

// ---------------------------------------------------------------------------
// The registry (module-scoped, in-process). Populated at build time by the host
// calling `registerRenderer` during startup wiring — never from network input.
// ---------------------------------------------------------------------------

const REGISTRY = new Map<string, RendererDefinition>();

/**
 * Register an in-process renderer. Re-registering the same id REPLACES the prior
 * one (last write wins) so a host can override a kit default deterministically.
 */
export function registerRenderer(def: RendererDefinition): void {
  REGISTRY.set(def.id, def);
}

/** Look up a registered renderer, or undefined when the id is unknown. */
export function getRenderer(id: string): RendererDefinition | undefined {
  return REGISTRY.get(id);
}

/** True when an id is registered. */
export function hasRenderer(id: string): boolean {
  return REGISTRY.has(id);
}

/** Remove a renderer (used by tests + hot-reload). */
export function unregisterRenderer(id: string): void {
  REGISTRY.delete(id);
}

/** Clear the whole registry (test isolation). */
export function clearRenderers(): void {
  REGISTRY.clear();
}

// ---------------------------------------------------------------------------
// Validation — does an item satisfy a renderer's declared `consumes` schema?
// ---------------------------------------------------------------------------

function kindMatches(kind: ConsumeKind, value: unknown): boolean {
  switch (kind) {
    case "any":
      return true;
    case "string":
    case "enum": // an enum value arrives as a string; the renderer maps it
      return typeof value === "string";
    case "number":
    case "currency": // currency is a numeric amount in minor/major units
      return typeof value === "number" && !Number.isNaN(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}

/**
 * Validate `item` against a `consumes` schema. A field whose kind ends in "?" is
 * optional — absent/undefined is allowed, but a present value still type-checks.
 * Extra keys on `item` not named in the schema are IGNORED (the renderer simply
 * won't read them); only declared fields are enforced.
 */
export function validateConsumes(consumes: ConsumesSchema, item: unknown): ValidationResult {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return { ok: false, errors: ["item must be a non-null object"] };
  }
  const record = item as Record<string, unknown>;
  const errors: string[] = [];
  for (const [key, spec] of Object.entries(consumes)) {
    const optional = spec.endsWith("?");
    const kind = (optional ? spec.slice(0, -1) : spec) as ConsumeKind;
    const value = record[key];
    if (value === undefined || value === null) {
      if (!optional) errors.push(`missing required "${key}" (${kind})`);
      continue;
    }
    if (!kindMatches(kind, value)) {
      errors.push(`"${key}" expected ${kind}, got ${typeof value}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
