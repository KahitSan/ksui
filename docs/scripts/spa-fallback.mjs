// Copy dist/index.html to dist/404.html so deep links resolve on GitHub Pages.
// Hash routing already sidesteps this, but the 404 fallback is a cheap belt and
// braces for any non hash path that gets hit directly.
import { copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "..", "dist");

await copyFile(resolve(dist, "index.html"), resolve(dist, "404.html"));
console.log("wrote dist/404.html");
