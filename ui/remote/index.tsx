// Remote UI entry for the transactions plugin. This plugin serves TWO host
// routes from ONE bundle (the multi-route model): `/transactions` and the
// folded-in `/payees`. The host passes the matched `routeBase`, so this single
// exported Component dispatches to the right page; the pages live in
// TransactionsPage.tsx and PayeesPage.tsx. solid-js + @kserp/host-ui are
// externalized to host globals (see vite.remote.config.ts).
import "./styles.css"; // plugin Tailwind utilities (host injects /_ui/remote.css)
import { Show } from "solid-js";
import PayeesPage from "./PayeesPage";
import TransactionsPage from "./TransactionsPage";

export function Component(props: { routeBase?: string }) {
  return (
    <Show when={props.routeBase === "payees"} fallback={<TransactionsPage />}>
      <PayeesPage />
    </Show>
  );
}
