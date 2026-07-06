// The compile-down core: routeToResourceSpec folds a RouteSpec DOWN to the
// EXISTING ksui ResourceUiSpec byte-identically, so ResourcePage (untouched) is
// the single render engine. THROWS on unrepresentable config (a 2nd view mode,
// a cards body, an unwired field kind) so the table-only subset is enforced at
// author/build time, never silently dropped. Pure — no solid-js, no host-ui.
import type { ResourceUiSpec, UiColumn, UiField } from "@kahitsan/ksui";
import type { BodyView, RouteSpec } from "./route-spec.js";
import { fieldToUiField } from "./form-spec.js";

/** Resolve the single body view, rejecting the multi-view / cards cases the
 *  table-only spine does not render yet. */
function resolveTableView(view: RouteSpec["view"]): BodyView {
  // A multi-view route ({views, default}) is the §5 toggle — not wired here.
  if ("views" in view) {
    throw new Error("adapter: multi-view routes are not supported in the table-only slice (a second view mode is the §5 toggle, deferred)");
  }
  if (view.kind !== "table") {
    throw new Error(`adapter: body view "${view.kind}" is not wired (only "table" lowers to ResourcePage in this slice)`);
  }
  return view;
}

function routeColumns(view: BodyView): UiColumn[] {
  if (view.kind !== "table") {
    throw new Error(`adapter: cannot lower a "${view.kind}" body to columns`);
  }
  return view.columns.map((c) =>
    c.orderable === undefined
      ? { key: c.key, title: c.title, render: c.render }
      : { key: c.key, title: c.title, orderable: c.orderable, render: c.render },
  );
}

function routeFields(route: RouteSpec): UiField[] {
  if (!route.form) return [];
  return Object.entries(route.form.fields).map(([key, def]) => fieldToUiField(key, def));
}

export function routeToResourceSpec(route: RouteSpec): ResourceUiSpec {
  const view = resolveTableView(route.view);

  const spec: ResourceUiSpec = {
    basePath: route.basePath,
    title: route.title,
    ...(route.subtitle !== undefined ? { subtitle: route.subtitle } : {}),
    permissions: {
      view: route.permissions.view,
      edit: route.permissions.edit,
      delete: route.permissions.delete,
    },
    softDeleteField: route.softDeleteField,
    testIdPrefix: route.testIdPrefix,
    columns: routeColumns(view),
    fields: routeFields(route),
    ...(route.toolbar?.filters !== undefined ? { filters: route.toolbar.filters } : {}),
    detail: route.detail,
    labels: route.labels,
  };
  return spec;
}
