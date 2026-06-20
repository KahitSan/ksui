// ksui component test setup.
//
// Every component injects a <style id="STYLE_ID"> once per page via
// ensureStyle(). In jsdom each test gets a fresh document, so injection is
// idempotent — but we still strip any leftover <style> tags between tests
// as a safety net (e.g. shared-document jsdom mode if ever enabled).
//
// Portal content is portaled to document.body; cleanup between tests so a
// previous test's portal DOM doesn't leak into the next one's queries.

import { afterEach } from "vitest";

afterEach(() => {
  // Strip injected style tags
  document.querySelectorAll("style").forEach((s) => s.remove());
  // Strip portal content (solid-js portals append to document.body)
  document.body.innerHTML = "";
});
