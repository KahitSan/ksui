import { test, expect } from "@playwright/test";
import { buildLogoSrc } from "../ui/remote/lib/account-logo-url";

// Regression guard for the account-avatar URL builder used in transaction
// payment-leg rows. Account logos are object-storage only now: buildLogoSrc
// takes the account's s3_link public URL directly (the legacy logo_path column
// + kernel /assets/ fallback are gone). kplugin_transactions has its OWN
// vendored AccountAvatar + buildLogoSrc copy (it can't import from another
// plugin), so a fix in the financial-accounts copy is invisible here.
//
// This is a function-level test because the full render path needs the
// financial-accounts plugin's accounts.financial_accounts table, which isn't
// mounted in transactions' standalone CI. The sister counter PR exercises the
// full render path. Here we cover the builder's contract directly: it is the
// <img src> boundary, so only an http(s) URL may pass — a stored
// javascript:/data:/vbscript: scheme would be stored XSS.

test.describe("buildLogoSrc — avatar URL shape", () => {
  test("returns an http(s) s3_link as-is", () => {
    expect(buildLogoSrc("https://cdn.hilinga.com/uploads/financial-accounts/1/abc.webp")).toBe(
      "https://cdn.hilinga.com/uploads/financial-accounts/1/abc.webp",
    );
    expect(buildLogoSrc("http://127.0.0.1:9000/bucket/uploads/financial-accounts/3/x.webp")).toBe(
      "http://127.0.0.1:9000/bucket/uploads/financial-accounts/3/x.webp",
    );
  });

  test("never emits a javascript:/data:/vbscript: scheme (XSS guard)", () => {
    expect(buildLogoSrc("javascript:alert(1)")).toBe("");
    expect(buildLogoSrc("data:text/html,<script>alert(1)</script>")).toBe("");
    expect(buildLogoSrc("vbscript:msgbox(1)")).toBe("");
  });

  test("yields an empty src when s3_link is absent (UI Show-guards before reaching this branch)", () => {
    expect(buildLogoSrc(null)).toBe("");
    expect(buildLogoSrc(undefined)).toBe("");
    expect(buildLogoSrc("")).toBe("");
  });
});
