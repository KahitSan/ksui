import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Regression guard for the account-avatar URL shape inside transaction
// payment-leg rows. The kernel switched from `/api/financial-accounts/:id/logo`
// (a per-plugin endpoint that's been deferred + 404s) to a session-authed,
// org-membership-gated `/assets/<plugin>/<orgId>/<filename>` static mount.
// kplugin_transactions has its OWN vendored AccountAvatar + buildLogoSrc copy
// (it can't import from another plugin), so a fix in the financial-accounts
// copy is invisible here. This spec inserts a transaction with one payment
// leg against a logo-bearing financial account, opens the detail modal, and
// asserts the rendered <img src> is on the new /assets/ shape (not the
// legacy /api/.../logo? URL).

const EMAIL = process.env.E2E_EMAIL || "admin@kahitsan.com";
const PASSWORD = process.env.E2E_PASSWORD || "password";
const ORG_ID = Number(process.env.E2E_ORG_ID || "1");

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("textbox", { name: /email/i }).fill(EMAIL);
  await page.getByRole("textbox", { name: /password/i }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  // Pin active org so the SPA injects X-Organization-Id on /api/* fetches.
  // CI seeds admin@kahitsan.com as superuser with no organization_members
  // row, so the client-side resolver falls through to null without this.
  await page.goto("/dashboard");
  await page.evaluate((id) => localStorage.setItem("ks_active_org_id", String(id)), ORG_ID);
  await page.waitForFunction(() => !!localStorage.getItem("ks_active_org_id"), { timeout: 5_000 });
}

function db(): Client {
  return new Client({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    database: process.env.DB_NAME || "ks_erp",
  });
}

test.describe("transaction payment-leg — avatar URL shape", () => {
  let faId: number | undefined;
  let txnId: number | undefined;
  let paymentId: number | undefined;
  const description = `avatar-url-spec-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  // logo_path must match the financial_accounts_logo_path_format_check
  // CHECK constraint: `^financial-accounts/\d+/[0-9a-f-]+\.webp$` (UUID shape).
  const TEST_LOGO_PATH = `financial-accounts/${ORG_ID}/${randomUUID()}.webp`;

  test.beforeAll(async () => {
    const c = db();
    await c.connect();
    try {
      // Financial account with logo_path so AccountAvatar takes the <img>
      // branch (otherwise it renders the lucide-icon fallback). The file
      // does not need to exist on disk — the assertion is the src attribute
      // the SPA bundle emits.
      const fa = await c.query<{ id: number }>(
        `INSERT INTO accounts.financial_accounts (organization_id, name, type, logo_path)
           VALUES ($1, $2, 'cash', $3)
           ON CONFLICT (organization_id, lower(name)) DO UPDATE SET logo_path = EXCLUDED.logo_path
           RETURNING id`,
        [ORG_ID, `Avatar URL Spec ${Date.now()}`, TEST_LOGO_PATH],
      );
      faId = fa.rows[0].id;

      const txn = await c.query<{ id: number }>(
        `INSERT INTO accounts.transactions
           (organization_id, category, amount, description, transaction_date, created_by)
           VALUES ($1, 'expense', 100, $2, CURRENT_DATE, $3)
           RETURNING id`,
        [ORG_ID, description, EMAIL],
      );
      txnId = txn.rows[0].id;

      const pay = await c.query<{ id: number }>(
        `INSERT INTO accounts.transaction_payments
           (transaction_id, organization_id, financial_account_id, amount)
           VALUES ($1, $2, $3, 100)
           RETURNING id`,
        [txnId, ORG_ID, faId],
      );
      paymentId = pay.rows[0].id;
    } finally {
      await c.end();
    }
  });

  test.afterAll(async () => {
    if (!txnId && !faId) return;
    const c = db();
    await c.connect();
    try {
      if (paymentId) {
        await c.query(`DELETE FROM accounts.transaction_payments WHERE id = $1`, [paymentId]);
      }
      if (txnId) {
        await c.query(`DELETE FROM accounts.transactions WHERE id = $1`, [txnId]);
      }
      if (faId) {
        await c.query(`DELETE FROM accounts.financial_accounts WHERE id = $1`, [faId]);
      }
    } finally {
      await c.end();
    }
  });

  test("detail modal payment-leg account avatar uses /assets/ URL", async ({ page }) => {
    await login(page);
    await page.goto("/transactions");
    await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();

    const row = page.getByText(description, { exact: false }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    await expect(page.getByTestId("transactions-detail-modal")).toBeVisible();

    // The detail modal renders the payment-leg row(s) containing the
    // account-avatar. testid is `account-avatar-<financialAccountId>`.
    const avatarImg = page.locator(`[data-testid="account-avatar-${faId}"] img`).first();
    await expect(avatarImg).toBeVisible({ timeout: 10_000 });

    const src = await avatarImg.getAttribute("src");
    // Hard-fail on the legacy URL — that's the bug this spec exists to catch.
    expect(src, `<img src=${src}>`).not.toMatch(/\/api\/financial-accounts\/\d+\/logo/);
    // Positive shape: /assets/<plugin>/<orgId>/<filename>. No ?v=, no ?orgId=.
    expect(src, `<img src=${src}>`).toBe(`/assets/${TEST_LOGO_PATH}`);
  });
});
