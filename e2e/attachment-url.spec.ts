import { test, expect } from "@playwright/test";
import { attachmentUrl, isResolvableAttachment } from "../ui/remote/lib/attachments";

// Regression guard for the attachment URL resolver. Both attachmentUrl and
// isResolvableAttachment feed straight into <a href> / <img src> at the
// transaction-detail render sites (ui/remote/index.tsx, ExistingAttachmentTile),
// so their contract is a security boundary, not just a formatting helper.
//
// Attachments are object-storage only now: the sole input is the s3_link public
// URL (the legacy file_path column + /assets fallback are gone). The resolver
// must let only http(s) through — a stored javascript:/data:/vbscript: scheme
// would be stored XSS — and yield an empty src for anything else.

test.describe("attachmentUrl — S3 link scheme allowlist", () => {
  test("returns an http(s) s3_link as-is", () => {
    expect(attachmentUrl("https://cdn.example.com/x.png")).toBe("https://cdn.example.com/x.png");
    expect(attachmentUrl("http://cdn.example.com/x.png")).toBe("http://cdn.example.com/x.png");
  });

  test("never returns a javascript:/data:/vbscript: scheme (XSS guard)", () => {
    expect(attachmentUrl("javascript:alert(1)")).toBe("");
    expect(attachmentUrl("data:text/html,<script>alert(1)</script>")).toBe("");
    expect(attachmentUrl("vbscript:msgbox(1)")).toBe("");
  });

  test("yields an empty src when s3_link is absent", () => {
    expect(attachmentUrl(null)).toBe("");
    expect(attachmentUrl(undefined)).toBe("");
    expect(attachmentUrl("")).toBe("");
  });
});

test.describe("isResolvableAttachment — S3 link aware", () => {
  test("a valid http(s) s3_link is resolvable", () => {
    expect(isResolvableAttachment("https://cdn.example.com/x.png")).toBe(true);
    expect(isResolvableAttachment("http://cdn.example.com/x.png")).toBe(true);
  });

  test("an unsafe or absent s3_link is not resolvable", () => {
    expect(isResolvableAttachment("javascript:alert(1)")).toBe(false);
    expect(isResolvableAttachment("blob:https://app/abc-123")).toBe(false);
    expect(isResolvableAttachment(null)).toBe(false);
    expect(isResolvableAttachment(undefined)).toBe(false);
    expect(isResolvableAttachment("")).toBe(false);
  });
});
