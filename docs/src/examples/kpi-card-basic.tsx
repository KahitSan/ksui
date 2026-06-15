// example-start
import { KpiCard } from "@kahitsan/ksui";
import { TrendingUp, Wallet, Users, AlertTriangle } from "lucide-solid";

export default function KpiCardBasic() {
  // KpiCard is presentational only. The caller pre-formats every value string
  // (currency, counts, percents) and picks a tone. Each tone colors the icon,
  // the value, and the optional sparkline.
  return (
    <div
      style={{
        padding: "1.5rem",
        display: "grid",
        "grid-template-columns": "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "1rem",
      }}
    >
      <KpiCard
        label="Revenue"
        value="₱128,400"
        tone="success"
        icon={TrendingUp}
        hint="vs ₱110,200 last week"
        sparkline={[40, 52, 48, 61, 70, 66, 82]}
      />
      <KpiCard
        label="Cash on hand"
        value="₱54,900"
        tone="info"
        icon={Wallet}
        hint="across 3 accounts"
        sparkline={[60, 58, 62, 55, 50, 53, 49]}
      />
      <KpiCard
        label="Active clients"
        value="312"
        tone="warning"
        icon={Users}
        hint="+8 this month"
        sparkline={[280, 290, 295, 300, 305, 309, 312]}
      />
      <KpiCard
        label="Overdue invoices"
        value="₱12,750"
        tone="danger"
        icon={AlertTriangle}
        hint="5 invoices past due"
      />
    </div>
  );
}
