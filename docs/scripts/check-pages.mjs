#!/usr/bin/env node
// Self-contained headless page checker for the ksui docs site.
// Usage: node scripts/check-pages.mjs "/" "/components/account-avatar" ...
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");
const BASE = "/ksui/";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
        // Strip the base path prefix.
        if (urlPath.startsWith(BASE)) urlPath = "/" + urlPath.slice(BASE.length);
        else if (urlPath === BASE.replace(/\/$/, "")) urlPath = "/";

        const ext = extname(urlPath);
        // No extension => SPA route, serve index.html (hash routing handles the rest).
        if (!ext || ext === "") {
          const html = await readFile(join(DIST, "index.html"));
          res.writeHead(200, { "content-type": CONTENT_TYPES[".html"] });
          res.end(html);
          return;
        }
        // Real asset: resolve safely inside DIST.
        const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
        const filePath = join(DIST, safe);
        if (!filePath.startsWith(DIST)) {
          res.writeHead(403); res.end("forbidden"); return;
        }
        try {
          const st = await stat(filePath);
          if (!st.isFile()) throw new Error("not a file");
          const body = await readFile(filePath);
          res.writeHead(200, { "content-type": CONTENT_TYPES[ext] || "application/octet-stream" });
          res.end(body);
        } catch {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("not found");
        }
      } catch (e) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(String(e));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function isBenign(url) {
  return /favicon\.ico(\?|$)/i.test(url);
}

async function checkRoute(browser, port, route) {
  const notes = [];
  const consoleErrors = [];
  const http4xx = [];
  let has5xx = false;
  const page = await browser.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const txt = msg.text();
      if (!isBenign(txt)) consoleErrors.push(txt);
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors.push("pageerror: " + (err?.message || String(err)));
  });
  page.on("response", (resp) => {
    const status = resp.status();
    const url = resp.url();
    if (status >= 400) {
      if (isBenign(url)) return;
      if (status >= 500) has5xx = true;
      http4xx.push({ url, status });
    }
  });

  const target = `http://127.0.0.1:${port}${BASE}#${route}`;
  let hasH1 = false;
  let previewCount = 0;
  let previewNonEmpty = false;
  const isComponentPage = route.startsWith("/components/");

  try {
    await page.goto(target, { waitUntil: "load", timeout: 30000 });
    try {
      await page.waitForSelector("main article h1", { timeout: 15000 });
    } catch {
      notes.push("h1 wait timed out");
    }
    // Short settle for live components to render.
    await page.waitForTimeout(800);

    hasH1 = await page.evaluate(() => !!document.querySelector("main article h1"));

    if (isComponentPage) {
      const r = await page.evaluate(() => {
        const boxes = Array.from(document.querySelectorAll(".bd-example"));
        return {
          count: boxes.length,
          nonEmpty: boxes.some((b) => b.childElementCount > 0),
        };
      });
      previewCount = r.count;
      previewNonEmpty = r.nonEmpty;
    }
  } catch (e) {
    notes.push("navigation error: " + (e?.message || String(e)));
  } finally {
    await page.close();
  }

  let ok = true;
  if (consoleErrors.length > 0) ok = false;
  if (has5xx) ok = false;
  if (!hasH1) ok = false;
  if (isComponentPage && (previewCount === 0 || !previewNonEmpty)) ok = false;

  return {
    route,
    ok,
    consoleErrors,
    http4xx,
    hasH1,
    previewCount,
    previewNonEmpty,
    notes,
  };
}

async function main() {
  const routes = process.argv.slice(2);
  if (routes.length === 0) {
    console.error("usage: node scripts/check-pages.mjs <route> [route...]");
    process.exit(0);
  }
  const { server, port } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const route of routes) {
      results.push(await checkRoute(browser, port, route));
    }
  } finally {
    await browser.close();
    await new Promise((res) => server.close(res));
  }
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

main();
