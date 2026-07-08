// Payees page — folded IN from the retired standalone payees plugin. Rendered
// when the host route is `/payees`. It is the data-shaped projection of the
// payees resource, drawn by the generic config-driven `ResourcePage` from
// `@kahitsan/ksui`; the spec is authored via ksui's defineRoute builders and
// compiled by ksui's routeToResourceSpec.
import { ResourcePage, routeToResourceSpec, type ResourcePageHost } from "@kahitsan/ksui";
import {
  PageShell,
  PageShareButton,
  useActiveWorkspace,
  usePermissions,
  useRouteSetting,
} from "@kserp/host-ui";
import { payeesRoute } from "../runtime/payees-route";

// The host route path this page renders at (uiRouteBase), used to resolve the
// per-user/per-workspace route settings (U3).
const ROUTE_PATH = "/payees";

export default function PayeesPage() {
  const perms = usePermissions();
  const { activeWorkspace } = useActiveWorkspace();
  const wsId = () => activeWorkspace()?.ws_id;

  // U3: the initial rows-per-page is the resolved route setting
  // (user pref ?? workspace default ?? the route's declared plugin_default).
  const pageSize = useRouteSetting(
    ROUTE_PATH,
    "pageSize",
    payeesRoute.settings?.pageSize?.default ?? 25,
  );
  const spec = { ...routeToResourceSpec(payeesRoute), pageLength: pageSize() };

  // Build the host config ONCE as a stable object — never inline in JSX. An
  // inline `host={{...}}` is re-evaluated on every `props.host.*` read, which
  // re-instantiates the `headerActions` element (PageShareButton) outside the
  // auth context and throws.
  const host: ResourcePageHost = {
    PageShell,
    can: (key) => perms.has(key),
    requestInit: () => {
      const id = wsId();
      const headers: Record<string, string> = {};
      if (id != null) headers["X-Workspace-Id"] = String(id);
      return { credentials: "include", headers };
    },
    refetchKey: () => wsId(),
    headerActions: () => <PageShareButton module="payees" moduleLabel="Payees" />,
  };

  return <ResourcePage spec={spec} host={host} />;
}
