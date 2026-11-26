import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { chooseArtwork } from "./trace-icon-artwork.mjs";
import { validateIconManifest, iconCellBounds } from "./icon-source-manifest.mjs";
import { writeIconModules } from "./write-icon-modules.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = path.join(root, "assets/icon-sources");
const outputRoot = path.join(root, "assets/icon-exports");
const artworkRoot = path.join(root, "src/icons/artwork");
const manifest = JSON.parse(
  await fs.readFile(path.join(sourceRoot, "manifest.json"), "utf8")
);
const contract = JSON.parse(await fs.readFile(new URL("./icon-artwork-contract.json", import.meta.url), "utf8"));
const legacy = JSON.parse(await fs.readFile(path.join(sourceRoot, "manifest-v1-historical.json"), "utf8"));
const onlyAvailable = process.argv.includes("--available");
const sourceCoverage = validateIconManifest(manifest, { allowPartial: onlyAvailable, expectedNames: contract.requiredSourceNames });
const pipelineHash = createHash("sha256").update(await fs.readFile(fileURLToPath(import.meta.url))).update(await fs.readFile(new URL("./trace-icon-artwork.mjs", import.meta.url))).update(await fs.readFile(new URL("./icon-source-manifest.mjs", import.meta.url))).digest("hex");
const previous = await fs.readFile(path.join(outputRoot, "metrics.generated.json"), "utf8").then(JSON.parse).catch(() => null);
const cached = previous?.pipelineHash === pipelineHash ? new Map(previous.icons.map((icon) => [icon.name, icon])) : new Map();
const edge = 144;
// These common navigation glyphs must paint without another image round-trip.
const inlineRasterNames = new Set(["panel-left-close", "inbox", "bir-office"]);
await fs.mkdir(outputRoot, { recursive: true });
await fs.mkdir(artworkRoot, { recursive: true });
const results = [];

for (const group of manifest.groups) {
  const file = path.join(sourceRoot, `${group.id}-original.png`);
  if (onlyAvailable) {
    try {
      await fs.access(file);
    } catch {
      continue;
    }
  }
  const assignmentHash = createHash("sha256").update(JSON.stringify({ id: group.id, rows: group.rows, columns: group.columns, names: group.names, rowBoundaries: group.rowBoundaries, columnBoundaries: group.columnBoundaries })).digest("hex");
  const sourceHash = createHash("sha256").update(await fs.readFile(file)).digest("hex");
  if (sourceHash !== group.sha256) throw new Error(`Source hash mismatch: ${group.id}`);
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let index = 0; index < group.names.length; index++) {
    const name = group.names[index];
    if (name === null) continue;
    const prior = cached.get(name);
    const required = [path.join(outputRoot, `${name}.png`), path.join(outputRoot, `${name}.svg`), path.join(artworkRoot, `${name}.ts`)];
    if (prior?.delivery.format === "png" && !inlineRasterNames.has(name)) required.push(path.join(artworkRoot, `${name}.png`));
    if (prior?.sourceSha256 === sourceHash && prior.assignmentHash === assignmentHash && (await Promise.all(required.map((file) => fs.access(file).then(() => true, () => false)))).every(Boolean)) {
      results.push(prior);
      continue;
    }
    const { left, top, right, bottom } = iconCellBounds(group, info, index);
    let x0 = right,
      y0 = bottom,
      x1 = -1,
      y1 = -1;
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        if (data[(y * info.width + x) * 4 + 3] > 16) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
    }
    if (x1 < x0 || y1 < y0) throw new Error(`Empty artwork: ${name}`);
    if (
      x0 <= left + 1 ||
      y0 <= top + 1 ||
      x1 >= right - 2 ||
      y1 >= bottom - 2
    ) {
      throw new Error(`Artwork crosses its cell boundary: ${name}`);
    }
    // Preserve a two-pixel edge around faint antialiasing before normalizing.
    x0 = Math.max(left, x0 - 2);
    y0 = Math.max(top, y0 - 2);
    x1 = Math.min(right - 1, x1 + 2);
    y1 = Math.min(bottom - 1, y1 + 2);
    const normalized = await sharp(file)
      .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
      .resize((edge * 5) / 6, (edge * 5) / 6, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .extend({
        top: edge / 12,
        bottom: edge / 12,
        left: edge / 12,
        right: edge / 12,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Only alpha is rendered. Constant white RGB allows lossless palette encoding.
    for (let pixel = 0; pixel < normalized.data.length; pixel += 4) {
      normalized.data[pixel] = 255;
      normalized.data[pixel + 1] = 255;
      normalized.data[pixel + 2] = 255;
    }
    const raw = normalized.data;
    const encode = () => sharp(raw, { raw: normalized.info });
    let png = await encode()
      .png({
        palette: true,
        colours: 256,
        dither: 0,
        quality: 100,
        compressionLevel: 9,
      })
      .toBuffer();
    const alpha = Buffer.from(raw.filter((_, index) => index % 4 === 3));
    const decoded = await sharp(png)
      .ensureAlpha()
      .extractChannel("alpha")
      .raw()
      .toBuffer();
    const paletteExact = decoded.equals(alpha);
    if (!paletteExact)
      png = await encode().png({ compressionLevel: 9 }).toBuffer();
    const roundTrip = await sharp(png)
      .ensureAlpha()
      .extractChannel("alpha")
      .raw()
      .toBuffer();
    if (!roundTrip.equals(alpha))
      throw new Error(`Non-lossless alpha encoding: ${name}`);
    await fs.writeFile(path.join(outputRoot, `${name}.png`), png);
    const rotations = [...new Set([0, ...contract.runtime.filter((item) => item.source === name).map((item) => item.rotation)])];
    const chosen = await chooseArtwork(png, alpha, edge, { rotations });
    if (chosen.metrics.format === "png" && !inlineRasterNames.has(name)) {
      await fs.writeFile(path.join(artworkRoot, `${name}.png`), png);
    } else {
      await fs.rm(path.join(artworkRoot, `${name}.png`), { force: true });
    }
    await fs.writeFile(path.join(outputRoot, `${name}.svg`), chosen.svg);
    await fs.writeFile(
      path.join(artworkRoot, `${name}.ts`),
      chosen.metrics.format === "png" && !inlineRasterNames.has(name)
        ? `// Generated by scripts/build-icon-assets.mjs.\nimport image from "./${name}.png?url&no-inline";\nexport const artwork = { image };\n`
        : `// Generated by scripts/build-icon-assets.mjs.\nexport const artwork = ${JSON.stringify(chosen.artwork)};\n`
    );
    results.push({
      name,
      group: group.id,
      sourceSha256: sourceHash,
      assignmentHash,
      originalCell: { left, top, right, bottom },
      crop: { x0, y0, x1, y1 },
      width: edge,
      height: edge,
      bytes: png.length,
      paletteExact,
      decodedBytes: raw.length,
      delivery: chosen.metrics,
    });
  }
}

await fs.writeFile(
  path.join(outputRoot, "metrics.generated.json"),
  JSON.stringify({ edge, pipelineHash, expectedCount: sourceCoverage.expectedCount, complete: sourceCoverage.complete && results.length === sourceCoverage.expectedCount, icons: results }, null, 2) + "\n"
);

if (onlyAvailable && (!sourceCoverage.complete || results.length !== sourceCoverage.expectedCount)) {
  console.log(JSON.stringify({ generated: results.length, expected: sourceCoverage.expectedCount, partial: true }));
  process.exit(0);
}
await writeIconModules(root, contract, legacy);
console.log(
  JSON.stringify(
    {
      icons: results.length,
      bytes: results.reduce((n, icon) => n + icon.bytes, 0),
      largest: results.toSorted((a, b) => b.bytes - a.bytes).slice(0, 5),
    },
    null,
    2
  )
);
