// Remote UI entry for the transactions plugin. This plugin serves THREE host
// routes from ONE bundle (the multi-route model): `/transactions`, the folded-in
// `/payees`, and the folded-in `/analytics`. The host passes the matched
// `routeBase`, so this single exported Component dispatches to the right page; the
// pages live in TransactionsPage.tsx, PayeesPage.tsx and AnalyticsPage.tsx.
// solid-js + @kserp/host-ui are externalized to host globals (vite.remote.config.ts).
import "./styles.css"; // plugin Tailwind utilities (host injects /_ui/remote.css)
import { Match, Switch } from "solid-js";
import PayeesPage from "./PayeesPage";
import TransactionsPage from "./TransactionsPage";
import AnalyticsPage from "./AnalyticsPage";

export function Component(props: { routeBase?: string }) {
  return (
    <Switch fallback={<TransactionsPage />}>
      <Match when={props.routeBase === "payees"}>
        <PayeesPage />
      </Match>
      <Match when={props.routeBase === "analytics"}>
        <AnalyticsPage />
      </Match>
    </Switch>
  );
}
