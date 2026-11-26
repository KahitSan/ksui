import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import sharp from "sharp";
import { chooseArtwork } from "./trace-icon-artwork.mjs";

async function source(name) {
  const png = await fs.readFile(new URL(`../assets/icon-exports/${name}.png`, import.meta.url));
  const alpha = await sharp(png).ensureAlpha().extractChannel("alpha").raw().toBuffer();
  return { png, alpha };
}

test("a verified alternate cutoff avoids a raster request without weakening fidelity", async () => {
  const { png, alpha } = await source("search");
  const selected = await chooseArtwork(png, alpha, 144);
  assert.equal(selected.metrics.format, "vector");
  assert.equal(selected.metrics.threshold, 160);
  assert.ok(selected.metrics.pathBytes < png.length);
  assert.ok(selected.metrics.comparison.every((item) => item.meanAlphaError <= 0.04));
  assert.equal(selected.metrics.comparison.length, 18);
});

test("shared directional artwork is checked at every actual orientation and display density", async () => {
  const { png, alpha } = await source("arrow-down");
  const rotations = [0, 45, 90, 180, 225, 270];
  const selected = await chooseArtwork(png, alpha, 144, { rotations });
  assert.equal(selected.metrics.comparison.length, 18 * rotations.length);
  assert.deepEqual([...new Set(selected.metrics.comparison.map((item) => item.rotation))], rotations);
  if (selected.metrics.format === "vector") {
    assert.ok(selected.metrics.comparison.every((item) => item.meanAlphaError <= 0.04));
  } else {
    assert.ok(selected.artwork.startsWith("data:image/png;base64,"));
    assert.ok(selected.metrics.worstMeanAlphaError > 0.04 || selected.metrics.pathBytes >= png.length);
  }
});
