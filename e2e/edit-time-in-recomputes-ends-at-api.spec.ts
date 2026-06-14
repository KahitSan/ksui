import { test, expect, type APIRequestContext } from "@playwright/test";

// Regression coverage for the counter "edit time-in" action.
//
// The bug this guards: PATCH /api/transactions/:id/customer-group-started-at
// moved a line's `started_at` but left `ends_at` untouched. Because the insert
// always stores `ends_at = started_at + duration`, an edit that pushes
// `started_at` forward leaves `ends_at` stale — and if the new start lands a
// day after the old end, `ends_at < started_at` (an inverted window). The
// natural-day CASE in routes-line-items.ts then buckets the already-"ended"
// line by its OLD `ends_at` date, so a session whose start is TODAY surfaces
// on YESTERDAY's board. The card itself looks fine (the UI derives its window
// from started_at + duration), which is what made this sneaky.
//
// The fix recomputes `ends_at = started_at + (duration_value * quantity)` of
// the line's unit inside the same UPDATE, mirroring helpers-charge.ts.
//
// API-only — the counter UI is in a sibling plugin.

const EMAIL = process.env.E2E_EMAIL || "admin@kahitsan.com";
const PASSWORD = process.env.E2E_PASSWORD || "password";

// account_id / client_id are soft-refs stored as plain INTEGERs. On the
// standalone CI host (KSERP_PLUGINS=.) the clients/financial-accounts plugins
// are absent, so there is no FK to satisfy and arbitrary positive integers work
// (see charge-customer-groups.spec.ts). But a full stack (local worktree) DOES
// carry the clients FK, so provisioning below prefers REAL ids discovered over
// the API and only falls back to these constants when those plugins are off.
const FAKE_ACCOUNT_ID = 99_010;
const FAKE_CLIENT_ID = 99_210;

const HOUR_MS = 60 * 60 * 1000;

interface Ctx {
  wsId: number;
  accountId: number;
  clientId: number;
}

// Returns the first id from a paginated plugin list endpoint for the given org,
// or null when the endpoint is unmounted (standalone host) or the org is empty.
async function firstId(
  api: APIRequestContext,
  path: string,
  wsId: number,
): Promise<number | null> {
  const res = await api.get(path, { headers: { "x-workspace-id": String(wsId) } });
  if (!res.ok()) return null;
  const rows = ((await res.json()).data ?? []) as Array<{ id?: number }>;
  return rows[0]?.id ?? null;
}

async function signInAndProvision(api: APIRequestContext): Promise<Ctx> {
  const signIn = await api.post("/api/auth/sign-in/email", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);

  const orgsRes = await api.get("/api/workspaces");
  const orgsBody = await orgsRes.json();
  const orgs = (orgsBody.data ?? orgsBody) as Array<{ id: number }>;

  // Prefer an org that has BOTH a real financial account and a real client so
  // the charge satisfies any FK on a full stack. Fall back to the first org
  // with the fake constants (standalone CI host: no such FK).
  for (const o of orgs) {
    const accountId = await firstId(api, "/api/financial-accounts?limit=1", o.id);
    const clientId = await firstId(api, "/api/clients?limit=1", o.id);
    if (accountId != null && clientId != null) {
      return { wsId: o.id, accountId, clientId };
    }
  }
  return { wsId: orgs[0].id, accountId: FAKE_ACCOUNT_ID, clientId: FAKE_CLIENT_ID };
}

function manilaDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

async function lineFor(
  api: APIRequestContext,
  wsId: number,
  activeOn: string,
  txnId: number,
): Promise<Record<string, unknown> | undefined> {
  const res = await api.get(
    `/api/transaction-line-items?active_on=${activeOn}&include_voided=true&include_upcoming=true`,
    { headers: { "x-workspace-id": String(wsId) } },
  );
  expect(res.status()).toBe(200);
  const lines = (await res.json()).data as Array<Record<string, unknown>>;
  return lines.find((li) => li.transaction_id === txnId);
}

test("editing a customer-group started_at drags ends_at with it (no inverted window)", async ({
  request,
}) => {
  const { wsId, accountId, clientId } = await signInAndProvision(request);
  const headers = { "x-workspace-id": String(wsId), "content-type": "application/json" };

  // Initial live session: started an hour ago, 8h block → ends ~7h from now.
  const initialStart = new Date(Date.now() - 1 * HOUR_MS).toISOString();
  const today = manilaDate(Date.now());

  const charge = await request.post("/api/transactions/charge", {
    headers,
    data: {
      destination_account_id: accountId,
      client_id: clientId,
      client_ids: [clientId],
      items: [
        { description: "edit-ends-at bug", quantity: 1, unit_price: 100, duration_value: 8, duration_unit: "hour" },
      ],
      customer_groups: [
        { client_id: clientId, display_name: "EditEndsAt", is_payer: true, item_indices: [0], started_at: initialStart },
      ],
      transaction_date: today,
      amount_collected: 100,
    },
  });
  expect(charge.status(), await charge.text()).toBe(201);
  const txnId = (await charge.json()).transaction.id as number;

  // Grab the line on today's board and its customer_group_id. Sanity-check the
  // insert invariant: ends_at = started_at + 8h.
  const before = await lineFor(request, wsId, today, txnId);
  expect(before, "charged line should appear on today's board").toBeTruthy();
  const cgId = before!.customer_group_id as number;
  expect(cgId).toBeGreaterThan(0);
  expect(
    new Date(before!.ends_at as string).getTime() - new Date(before!.started_at as string).getTime(),
  ).toBe(8 * HOUR_MS);

  // ── Part A: same-day edit — ends_at must track the new start ───────────────
  // Move the start two hours earlier (still a live session today, so the line
  // stays fetchable regardless of the fix). Without the fix, ends_at stays at
  // initialStart + 8h; with it, ends_at = newStart + 8h.
  const newStart = new Date(Date.now() - 3 * HOUR_MS).toISOString();
  const patchA = await request.patch(`/api/transactions/${txnId}/customer-group-started-at`, {
    headers,
    data: { updates: [{ customer_group_id: cgId, started_at: newStart }], reason: "e2e edit time-in" },
  });
  expect(patchA.status(), await patchA.text()).toBe(200);

  const afterA = await lineFor(request, wsId, today, txnId);
  expect(afterA, "edited line should still be on today's board").toBeTruthy();
  expect(new Date(afterA!.started_at as string).getTime()).toBe(new Date(newStart).getTime());
  // The core contract: ends_at recomputed from the new start, never left stale.
  expect(
    new Date(afterA!.ends_at as string).getTime() - new Date(afterA!.started_at as string).getTime(),
    "ends_at must be exactly 8h after the edited started_at",
  ).toBe(8 * HOUR_MS);
  expect(
    new Date(afterA!.ends_at as string).getTime(),
    "ends_at must never precede started_at (inverted window)",
  ).toBeGreaterThan(new Date(afterA!.started_at as string).getTime());

  // ── Part B: the reported symptom — push start to yesterday ─────────────────
  // A start ~28h ago ends ~20h ago: a fully-elapsed session that belongs to
  // YESTERDAY's calendar date. With the fix it leaves today's board and lands
  // on yesterday's. Without the fix, ends_at would still be in the future, so
  // the line would wrongly stay on today's board and never reach yesterday's.
  const yStart = new Date(Date.now() - 28 * HOUR_MS).toISOString();
  const yDate = manilaDate(Date.now() - 28 * HOUR_MS);
  // Guard against the rare run where 28h-ago and now-8h straddle differently:
  // only assert the board move when the two dates genuinely differ.
  test.skip(yDate === today, "28h window did not cross a Manila day boundary in this run");
  // Near Manila midnight the 8h session itself straddles a day boundary (e.g.
  // started 20:12 yesterday → ends 04:12 today), so it does NOT bucket wholly
  // onto yDate's board — the bucketing is genuinely ambiguous and the assertion
  // below flakes. Only assert when the elapsed session lands entirely within
  // yDate. (This is the same "skip the ambiguous boundary case" discipline as the
  // guard above; it closes the once-a-day midnight window the first guard misses.)
  const yEndDate = manilaDate(Date.parse(yStart) + 8 * HOUR_MS);
  test.skip(
    yEndDate !== yDate,
    "elapsed 8h session straddles a Manila day boundary (near-midnight run) — board bucketing is ambiguous",
  );

  const patchB = await request.patch(`/api/transactions/${txnId}/customer-group-started-at`, {
    headers,
    data: { updates: [{ customer_group_id: cgId, started_at: yStart }], reason: "e2e edit to yesterday" },
  });
  expect(patchB.status(), await patchB.text()).toBe(200);

  const onYesterday = await lineFor(request, wsId, yDate, txnId);
  expect(onYesterday, "elapsed session should bucket onto yesterday's board").toBeTruthy();
  expect(
    new Date(onYesterday!.ends_at as string).getTime() - new Date(onYesterday!.started_at as string).getTime(),
  ).toBe(8 * HOUR_MS);

  const stillToday = await lineFor(request, wsId, today, txnId);
  expect(stillToday, "elapsed yesterday session must NOT linger on today's board").toBeFalsy();
});
