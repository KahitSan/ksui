import sharp from "sharp";
import potrace from "potrace";
import { optimize } from "svgo";

/** Compare vector exports to their generated bitmap, retaining difficult originals. */
export async function chooseArtwork(png, alpha, edge) {
  const { svg, path } = await traceBitmap(alpha, edge);
  const comparison = await compareSizes(png, svg, edge);
  const worst = Math.max(...comparison.map((item) => item.meanAlphaError));
  const useVector = worst <= 0.04 && Buffer.byteLength(path) < png.length;
  return {
    artwork: useVector
      ? path
      : `data:image/png;base64,${png.toString("base64")}`,
    svg,
    metrics: {
      format: useVector ? "vector" : "png",
      pathBytes: Buffer.byteLength(path),
      worstMeanAlphaError: worst,
      comparison,
    },
  };
}

async function compareAtSize(png, svg, edge, size, dpr) {
  const target = size * dpr;
  const original = await sharp(png)
    .resize(target, target)
    .ensureAlpha()
    .extractChannel("alpha")
    .raw()
    .toBuffer();
  const vector = await sharp(Buffer.from(svg), {
    density: (72 * target) / edge,
  })
    .ensureAlpha()
    .extractChannel("alpha")
    .raw()
    .toBuffer();
  if (vector.length !== original.length)
    throw new Error("Trace comparison dimensions differ");
  let error = 0;
  for (let i = 0; i < original.length; i++)
    error += Math.abs(original[i] - vector[i]);
  return { size, dpr, meanAlphaError: error / original.length / 255 };
}

async function traceBitmap(alpha, edge) {
  const bitmap = await sharp(Buffer.from(alpha.map((value) => 255 - value)), {
    raw: { width: edge, height: edge, channels: 1 },
  })
    .png()
    .toBuffer();
  const traced = await new Promise((resolve, reject) => {
    potrace.trace(
      bitmap,
      { threshold: 128, turdSize: 0, optTolerance: 0.1, color: "currentColor" },
      (error, svg) => (error ? reject(error) : resolve(svg))
    );
  });
  const svg = optimize(traced, {
    plugins: [
      { name: "convertPathData", params: { floatPrecision: 2 } },
      "cleanupNumericValues",
    ],
  }).data;
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)];
  if (paths.length !== 1 || /<path\b[^>]*\btransform=/.test(svg))
    throw new Error("Unexpected trace structure");
  const path = paths[0][1];
  return { svg, path };
}

async function compareSizes(png, svg, edge) {
  const comparison = [];
  for (const size of [8, 12, 16, 24, 48, 54]) {
    for (const dpr of [1, 2, 3]) {
      comparison.push(await compareAtSize(png, svg, edge, size, dpr));
    }
  }
  return comparison;
}
