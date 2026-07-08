// Remote UI entry for the finance plugin (formerly `transactions`). Serves FOUR
// host routes from ONE bundle via the `pages` export: the HOST dispatches the
// matched routeBase to the right page, so the manifest `routes[]` and this map
// are the same list — an unmapped route fails loud in the host instead of
// silently rendering a fallback page.
// solid-js + @kserp/host-ui are externalized to host globals (vite.remote.config.ts).
import "./styles.css"; // plugin Tailwind utilities (host injects /_ui/remote.css)
import PayeesPage from "./PayeesPage";
import TransactionsPage from "./TransactionsPage";
import AnalyticsPage from "./AnalyticsPage";
import AccountsPage from "./AccountsPage";

export const pages = {
  transactions: TransactionsPage,
  payees: PayeesPage,
  "financial-accounts": AccountsPage,
  analytics: AnalyticsPage,
};
