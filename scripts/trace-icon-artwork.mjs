import sharp from "sharp";
import potrace from "potrace";
import { optimize } from "svgo";

/** Compare vector exports to their generated bitmap, retaining difficult originals. */
export async function chooseArtwork(png, alpha, edge, { rotations = [0] } = {}) {
  const candidates = await traceCandidates(png, alpha, edge, rotations);
  const passing = candidates.filter((item) => fitsVector(item, png.length));
  let chosen = passing.sort((a, b) => a.pathBytes - b.pathBytes || a.threshold - b.threshold)[0]
    ?? candidates.toSorted((a, b) => a.worst - b.worst || a.threshold - b.threshold)[0];
  const useVector = passing.length > 0;
  if (useVector) chosen = await compactVector(chosen, png, edge, rotations);
  return {
    artwork: useVector ? chosen.path : `data:image/png;base64,${png.toString("base64")}`,
    svg: chosen.svg,
    metrics: {
      format: useVector ? "vector" : "png",
      threshold: chosen.threshold,
      precision: chosen.precision,
      pathBytes: chosen.pathBytes,
      worstMeanAlphaError: chosen.worst,
      comparison: chosen.comparison,
      candidates: candidates.map(({ threshold, pathBytes, worst }) => ({ threshold, pathBytes, worstMeanAlphaError: worst })),
      precisionCandidates: chosen.precisionCandidates,
    },
  };
}

const fitsVector = (candidate, bytes) => candidate.worst <= 0.04 && candidate.pathBytes < bytes;

async function traceCandidates(png, alpha, edge, rotations) {
  const candidates = [];
  for (const threshold of [128, 96, 112, 144, 160]) {
    const { svg, path } = await traceBitmap(alpha, edge, threshold);
    const comparison = await compareSizes(png, svg, edge, rotations);
    const worst = Math.max(...comparison.map((item) => item.meanAlphaError));
    candidates.push({ svg, path, threshold, comparison, worst, pathBytes: Buffer.byteLength(path) });
    // Do not spend extra tracing work on an already-small verified vector.
    if (threshold === 128 && fitsVector(candidates.at(-1), png.length)) break;
  }
  return candidates;
}

async function compactVector(original, png, edge, rotations) {
  let selected = { ...original, precision: 2 };
  const precisionCandidates = [];
  for (const precision of [1, 0]) {
    const svg = optimize(original.svg, { plugins: [{ name: "convertPathData", params: { floatPrecision: precision } }, "cleanupNumericValues"] }).data;
    const geometry = vectorGeometry(svg);
    const comparison = await compareSizes(png, svg, edge, rotations);
    const worst = Math.max(...comparison.map((item) => item.meanAlphaError));
    const pathBytes = Buffer.byteLength(geometry.path);
    precisionCandidates.push({ precision, pathBytes, worstMeanAlphaError: worst });
    if (worst <= 0.04 && pathBytes < selected.pathBytes) selected = { ...original, ...geometry, precision, pathBytes, comparison, worst };
  }
  return { ...selected, precisionCandidates };
}

async function compareAtSize(png, svg, edge, size, dpr, rotation) {
  const target = size * dpr;
  const rotated = (source) => source.replace(/(<svg\b[^>]*>)([\s\S]*)(<\/svg>)/, `$1<g transform="rotate(${rotation} ${edge / 2} ${edge / 2})">$2</g>$3`);
  const rasterSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${edge}" height="${edge}" viewBox="0 0 ${edge} ${edge}"><image href="data:image/png;base64,${png.toString("base64")}" width="${edge}" height="${edge}"/></svg>`;
  const originalImage = rotation
    ? sharp(Buffer.from(rotated(rasterSvg)), { density: (72 * target) / edge })
    : sharp(png).resize(target, target);
  const original = await originalImage
    .ensureAlpha()
    .extractChannel("alpha")
    .raw()
    .toBuffer();
  const vector = await sharp(Buffer.from(rotation ? rotated(svg) : svg), {
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
  return { size, dpr, rotation, meanAlphaError: error / original.length / 255 };
}

async function traceBitmap(alpha, edge, threshold) {
  const bitmap = await sharp(Buffer.from(alpha.map((value) => 255 - value)), {
    raw: { width: edge, height: edge, channels: 1 },
  })
    .png()
    .toBuffer();
  const traced = await new Promise((resolve, reject) => {
    potrace.trace(
      bitmap,
      { threshold, turdSize: 0, optTolerance: 0.1, color: "currentColor" },
      (error, svg) => (error ? reject(error) : resolve(svg))
    );
  });
  const svg = optimize(traced, {
    plugins: [
      { name: "convertPathData", params: { floatPrecision: 2 } },
      "cleanupNumericValues",
    ],
  }).data;
  return vectorGeometry(svg);
}

function vectorGeometry(svg) {
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)];
  if (paths.length !== 1 || /<path\b[^>]*\btransform=/.test(svg))
    throw new Error("Unexpected trace structure");
  const path = paths[0][1];
  return { svg, path };
}

async function compareSizes(png, svg, edge, rotations) {
  const comparison = [];
  for (const size of [8, 12, 16, 24, 48, 54]) {
    for (const dpr of [1, 2, 3]) {
      for (const rotation of rotations) comparison.push(await compareAtSize(png, svg, edge, size, dpr, rotation));
    }
  }
  return comparison;
}
