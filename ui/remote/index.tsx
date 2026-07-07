// Remote UI entry for the finance plugin (formerly `transactions`). Serves FOUR
// host routes from ONE bundle (multi-route model): `/transactions`, `/payees`,
// `/analytics`, and the folded-in `/financial-accounts`. The host passes the
// matched `routeBase`, and this single Component dispatches to the right page.
// Pages: TransactionsPage.tsx, PayeesPage.tsx, AnalyticsPage.tsx, AccountsPage.tsx.
// solid-js + @kserp/host-ui are externalized to host globals (vite.remote.config.ts).
import "./styles.css"; // plugin Tailwind utilities (host injects /_ui/remote.css)
import { Match, Switch } from "solid-js";
import PayeesPage from "./PayeesPage";
import TransactionsPage from "./TransactionsPage";
import AnalyticsPage from "./AnalyticsPage";
import AccountsPage from "./AccountsPage";

export function Component(props: { routeBase?: string }) {
  return (
    <Switch fallback={<TransactionsPage />}>
      <Match when={props.routeBase === "payees"}>
        <PayeesPage />
      </Match>
      <Match when={props.routeBase === "analytics"}>
        <AnalyticsPage />
      </Match>
      <Match when={props.routeBase === "financial-accounts"}>
        <AccountsPage />
      </Match>
    </Switch>
  );
}
