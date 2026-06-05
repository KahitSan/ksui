import { test, expect } from "@playwright/test";
import { attachmentUrl, isResolvableAttachment } from "../ui/remote/lib/attachments";

// Regression guard for the attachment URL resolver. Both attachmentUrl and
// isResolvableAttachment feed straight into <a href> / <img src> at the
// transaction-detail render sites (ui/remote/index.tsx, ExistingAttachmentTile),
// so their contract is a security boundary, not just a formatting helper.
//
// These are function-level tests (the account-avatar-url spec is the precedent):
// the integration path needs a real attachment row carrying an arbitrary
// s3_link, which the standalone-plugin CI fixture can't seed safely, while the
// function contract is fully exercisable here. Each assertion below fails
// against the pre-fix code — attachmentUrl returned s3Link unconditionally
// (so a javascript: scheme passed straight through), and isResolvableAttachment
// ignored s3_link entirely (so a valid S3 link behind a dead blob: file_path
// rendered as "unavailable").

test.describe("attachmentUrl — S3 link scheme allowlist", () => {
  test("returns an http(s) s3_link as-is", () => {
    expect(attachmentUrl("transactions/1/x.png", "https://cdn.example.com/x.png")).toBe(
      "https://cdn.example.com/x.png",
    );
    expect(attachmentUrl("transactions/1/x.png", "http://cdn.example.com/x.png")).toBe(
      "http://cdn.example.com/x.png",
    );
  });

  test("never returns a javascript:/data:/vbscript: s3_link (XSS guard)", () => {
    // Pre-fix these were returned verbatim into href/src — stored XSS.
    expect(attachmentUrl("transactions/1/x.png", "javascript:alert(1)")).not.toContain(
      "javascript:",
    );
    expect(
      attachmentUrl("transactions/1/x.png", "data:text/html,<script>alert(1)</script>"),
    ).not.toMatch(/^data:/i);
    expect(attachmentUrl("transactions/1/x.png", "vbscript:msgbox(1)")).not.toMatch(
      /^vbscript:/i,
    );
  });

  test("falls through to the /assets mount when s3_link is unsafe", () => {
    // A dangerous s3_link must not suppress the safe file_path resolution.
    expect(attachmentUrl("transactions/1/x.png", "javascript:alert(1)")).toBe(
      "/assets/transactions/1/x.png",
    );
  });

  test("resolves the relative file_path when s3_link is absent", () => {
    expect(attachmentUrl("transactions/1/x.png")).toBe("/assets/transactions/1/x.png");
    expect(attachmentUrl("transactions/1/x.png", null)).toBe("/assets/transactions/1/x.png");
  });
});

test.describe("isResolvableAttachment — S3 link aware", () => {
  test("treats a row with a valid http(s) s3_link as resolvable even when file_path is a dead blob:", () => {
    expect(isResolvableAttachment("blob:https://app/abc-123", "https://cdn.example.com/x.png")).toBe(
      true,
    );
  });

  test("ignores an unsafe s3_link and falls back to file_path", () => {
    expect(isResolvableAttachment("blob:https://app/abc-123", "javascript:alert(1)")).toBe(false);
  });

  test("keeps the original behaviour when no s3_link is given", () => {
    expect(isResolvableAttachment("transactions/1/x.png")).toBe(true);
    expect(isResolvableAttachment("blob:https://app/abc-123")).toBe(false);
    expect(isResolvableAttachment(null)).toBe(false);
    expect(isResolvableAttachment(undefined)).toBe(false);
  });
});
