import { test, expect } from "@playwright/test";
import { buildLogoSrc } from "../ui/remote/lib/account-logo-url";

// Regression guard for the account-avatar URL shape used in transaction
// payment-leg rows. The kernel switched from `/api/financial-accounts/:id/logo`
// (a per-plugin endpoint that's been deferred + 404s) to a session-authed,
// org-membership-gated `/assets/<plugin>/<orgId>/<filename>` static mount.
// kplugin_transactions has its OWN vendored AccountAvatar + buildLogoSrc copy
// (it can't import from another plugin), so a fix in the financial-accounts
// copy is invisible here.
//
// This is a function-level test because the integration path — render the
// avatar in a transaction's payment-leg row — requires the financial-accounts
// plugin's `accounts.financial_accounts` table, which is owned by that plugin
// and is NOT mounted in transactions' standalone CI environment. The sister
// counter PR exercises the full render path (counter's CI fixture creates a
// financial_accounts row), so the URL builder is integration-covered there;
// here we cover the function contract directly. Both tests would have failed
// against the pre-fix code: the legacy 2-arg signature does not match a 1-arg
// call, and the legacy return string does not match the /assets/ shape.

test.describe("buildLogoSrc — avatar URL shape", () => {
  test("emits /assets/<logoPath> with no query string", () => {
    expect(buildLogoSrc("financial-accounts/1/abc.webp")).toBe(
      "/assets/financial-accounts/1/abc.webp",
    );
    expect(
      buildLogoSrc("financial-accounts/3/3d6ca004-4451-4274-b38c-62396e70e8be.webp"),
    ).toBe("/assets/financial-accounts/3/3d6ca004-4451-4274-b38c-62396e70e8be.webp");
  });

  test("does not emit the legacy /api/financial-accounts/:id/logo URL", () => {
    const url = buildLogoSrc("financial-accounts/1/abc.webp");
    expect(url, `<img src=${url}>`).not.toMatch(/\/api\/financial-accounts\/.*\/logo/);
    expect(url, `<img src=${url}>`).not.toContain("?v=");
    expect(url, `<img src=${url}>`).not.toContain("&orgId=");
  });

  test("renders an empty path segment for null/undefined (UI Show-guards before reaching this branch)", () => {
    expect(buildLogoSrc(null)).toBe("/assets/");
    expect(buildLogoSrc(undefined)).toBe("/assets/");
  });
});
