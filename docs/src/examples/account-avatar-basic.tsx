// example-start
import { AccountAvatar, type AvatarAccount } from "@kahitsan/ksui";

// AccountAvatar is a pure display chip, so there is no trigger to wire up.
// In the real app it sits on the /financial-accounts page and in the
// calendar/mention lists. We show it with small labeled rows, the same way
// the app lays these chips out next to a name.
export default function AccountAvatarBasic() {
  const rows: { account: AvatarAccount; label: string }[] = [
    { account: { id: 0, type: "user", name: "Maria Cruz" }, label: "User badge, falls back to initials" },
    { account: { id: 1, type: "bank", icon: "landmark", color: "#0ea5e9" }, label: "Bank account, chosen icon" },
    { account: { id: 2, type: "cash", name: "Cash Drawer" }, label: "Cash account, type default icon" },
  ];

  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "1rem",
      }}
    >
      {rows.map((row) => (
        <div class="flex items-center gap-3">
          <AccountAvatar account={row.account} size={40} />
          <span class="text-sm text-zinc-300">{row.label}</span>
        </div>
      ))}
    </div>
  );
}
