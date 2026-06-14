import { test, expect, type APIRequestContext } from "@playwright/test";

// Regression coverage for the "Active now" board scope.
//
// The bug this guards: a charge rung up with a yesterday Manila
// `transaction_date` (a backdated entry) but whose per-customer-group
// `started_at` lands on TODAY Manila (the cashier rang it up after midnight
// while still counting it against yesterday's books). The natural-day CASE
// returns `t.transaction_date` for actively-running lines, so the line was
// invisible under today's filter; the carryover arm also missed it because
// `started_at` is not strictly before today::date. Net effect: an active
// rental disappeared from the Live board the moment the cashier crossed
// midnight, even though the session was visibly still in progress.
//
// API-only — the counter UI is in a sibling plugin. The fix lives in
// `GET /api/transaction-line-items` (routes-line-items.ts).

const EMAIL = process.env.E2E_EMAIL || "admin@kahitsan.com";
const PASSWORD = process.env.E2E_PASSWORD || "password";

interface Ctx {
  wsId: number;
  accountId: number;
  client1Id: number;
  client2Id: number;
}

// See charge-customer-groups.spec.ts for the soft-ref rationale: the plugin
// stores destination_account_id / client_id as plain INTEGERs with no FK,
// so the standalone CI host (which loads only this plugin) can charge using
// arbitrary positive integers as account / client ids.
const FAKE_ACCOUNT_ID = 99_002;
const FAKE_CLIENT_1_ID = 99_201;
const FAKE_CLIENT_2_ID = 99_202;

async function signInAndProvision(api: APIRequestContext): Promise<Ctx> {
  const signIn = await api.post("/api/auth/sign-in/email", {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);

  const orgsRes = await api.get("/api/workspaces");
  const orgsBody = await orgsRes.json();
  const orgs = orgsBody.data ?? orgsBody;
  const wsId = orgs[0].id as number;

  return {
    wsId,
    accountId: FAKE_ACCOUNT_ID,
    client1Id: FAKE_CLIENT_1_ID,
    client2Id: FAKE_CLIENT_2_ID,
  };
}

// Returns today and yesterday in Manila local date format. Uses Intl with
// timeZone instead of toISOString to avoid the UTC-vs-PHT confusion the
// monolith's KSERP.md flags as a banned shape in tests.
function manilaTodayAndYesterday(): { today: string; yesterday: string } {
  const today = manilaDate(Date.now());
  const yesterday = manilaDate(Date.now() - 24 * 60 * 60 * 1000);
  return { today, yesterday };
}

function manilaDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

test("backdated transaction with currently-running session surfaces under today's filter", async ({
  request,
}) => {
  const { wsId, accountId, client1Id, client2Id } = await signInAndProvision(request);
  const { today, yesterday } = manilaTodayAndYesterday();
  const headers = { "x-workspace-id": String(wsId), "content-type": "application/json" };

  // started_at = a few minutes ago, ends_at = several hours from now → live session.
  // Anchor to ten minutes ago to give a comfortable buffer either side of the
  // NOW() comparisons.
  const startedAtMs = Date.now() - 10 * 60 * 1000;
  // Within ~10 min after Manila midnight, started_at (now - 10min) is still
  // YESTERDAY Manila while transaction_date is also yesterday — so the "today
  // carryover" arm (which fires for sessions whose started_at is today) would
  // not engage, and the today-filter assertion below would legitimately see 0.
  // Skip that narrow once-a-day boundary window; the day-shifted scenario is
  // ambiguous, not buggy. (Same midnight-boundary discipline as
  // edit-time-in-recomputes-ends-at-api.spec.ts.)
  test.skip(
    manilaDate(startedAtMs) !== manilaDate(Date.now()),
    "started_at and now straddle a Manila midnight boundary — today-carryover arm is ambiguous",
  );
  const startedAt = new Date(startedAtMs).toISOString();

  // transaction_date is YESTERDAY Manila — the backdated entry shape.
  const charge = await request.post("/api/transactions/charge", {
    headers,
    data: {
      destination_account_id: accountId,
      client_id: client1Id,
      client_ids: [client1Id, client2Id],
      items: [
        {
          description: "active-now-bug cg1",
          quantity: 1,
          unit_price: 100,
          duration_value: 8,
          duration_unit: "hour",
        },
        {
          description: "active-now-bug cg2",
          quantity: 1,
          unit_price: 100,
          duration_value: 8,
          duration_unit: "hour",
        },
      ],
      customer_groups: [
        {
          client_id: client1Id,
          display_name: "Anow1",
          is_payer: true,
          item_indices: [0],
          started_at: startedAt,
        },
        {
          client_id: client2Id,
          display_name: "Anow2",
          is_payer: false,
          item_indices: [1],
          started_at: startedAt,
        },
      ],
      transaction_date: yesterday,
      amount_collected: 200,
    },
  });
  expect(charge.status(), await charge.text()).toBe(201);
  const txnId = (await charge.json()).transaction.id as number;

  // Today filter — must include the still-running lines.
  const todayRes = await request.get(
    `/api/transaction-line-items?active_on=${today}&include_voided=true&include_upcoming=true`,
    { headers: { "x-workspace-id": String(wsId) } },
  );
  expect(todayRes.status()).toBe(200);
  const todayLines = (await todayRes.json()).data as Array<Record<string, unknown>>;
  const todayMatches = todayLines.filter((li) => li.transaction_id === txnId);
  expect(
    todayMatches.length,
    "expected the backdated transaction's running lines to show under today's filter",
  ).toBe(2);

  // Yesterday filter — backwards compatibility: the line should still appear
  // there (it belongs to yesterday's calendar date).
  const yestRes = await request.get(
    `/api/transaction-line-items?active_on=${yesterday}&include_voided=true&include_upcoming=true`,
    { headers: { "x-workspace-id": String(wsId) } },
  );
  const yestLines = (await yestRes.json()).data as Array<Record<string, unknown>>;
  expect(yestLines.filter((li) => li.transaction_id === txnId).length).toBe(2);

  // An unrelated past day must not surface the live session. The rescue arm
  // is scoped to Manila today, so older dates shouldn't accidentally inherit
  // every currently-running rental.
  const farPast = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const farRes = await request.get(
    `/api/transaction-line-items?active_on=${farPast}&include_voided=true&include_upcoming=true`,
    { headers: { "x-workspace-id": String(wsId) } },
  );
  const farLines = (await farRes.json()).data as Array<Record<string, unknown>>;
  expect(farLines.filter((li) => li.transaction_id === txnId).length).toBe(0);
});
