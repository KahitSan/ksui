// example-start
import { AccountAvatar, resolveAccount, resolveAccountName, type AvatarAccount } from "@kahitsan/ksui";

// A fake, already-loaded index shaped exactly like what useAccountsIndex()
// resolves to. The pure resolveAccount / resolveAccountName helpers read this
// map directly, so there is no backend or host mock needed. In the real app a
// page builds this once per org, then every row resolves an account id to its
// avatar and name without another fetch.
const byId = new Map<number, AvatarAccount>([
  [10, { id: 10, type: "bank", icon: "landmark", color: "#0ea5e9" }],
  [11, { id: 11, type: "cash", icon: null, color: null }],
]);
const nameById = new Map<number, string>([
  [10, "BPI Savings"],
  [11, "Cash Drawer"],
]);
const fakeIndex = { byId, nameById };

export default function UseAccountsIndexBasic() {
  // 10 and 11 are in the index; 999 is missing, so the helper falls back to a
  // generic external-account chip and an unknown name. This is the same path
  // a deleted or not-yet-loaded account takes in the real app.
  const ids = [10, 11, 999];
  return (
    <div
      style={{
        padding: "1.5rem",
        "border-radius": "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "0.75rem",
      }}
    >
      {ids.map((id) => {
        const acct = resolveAccount(fakeIndex, id);
        const name = resolveAccountName(fakeIndex, id);
        return (
          <div style={{ display: "flex", "align-items": "center", gap: "0.625rem" }}>
            {acct && <AccountAvatar account={acct} size={28} />}
            <code
              class="text-zinc-400"
              style={{
                "font-size": "0.8rem",
                background: "rgba(127,127,127,0.12)",
                padding: "0.125rem 0.4rem",
                "border-radius": "0.25rem",
              }}
            >
              id {id}
            </code>
            <span class="text-zinc-200" style={{ "font-size": "0.9rem" }}>{name ?? "unknown"}</span>
          </div>
        );
      })}
    </div>
  );
}
