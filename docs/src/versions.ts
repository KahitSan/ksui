// Version metadata for the docs version filter.
//
// The version dropdown FILTERS the documented catalog to a chosen release: the
// sidebar shows only what existed then, and components removed since render with
// an "Obsolete since vX.Y.Z" banner (their code example is retained). After a
// release, add the new entry to the top of VERSIONS and bump CURRENT_VERSION.
// See RELEASING.md at the repo root.
import { createSignal } from "solid-js";

export const CURRENT_VERSION = "0.11.0";

export type VersionEntry = {
  version: string;
  /** GitHub release tag for that version (release notes). */
  url: string;
};

const tag = (v: string) => `https://github.com/KahitSan/ksui/releases/tag/v${v}`;

// Newest first.
export const VERSIONS: VersionEntry[] = [
  { version: "0.11.0", url: tag("0.11.0") },
  { version: "0.10.2", url: tag("0.10.2") },
  { version: "0.10.1", url: tag("0.10.1") },
  { version: "0.10.0", url: tag("0.10.0") },
  { version: "0.9.0", url: tag("0.9.0") },
  { version: "0.8.0", url: tag("0.8.0") },
  { version: "0.7.1", url: tag("0.7.1") },
  { version: "0.7.0", url: tag("0.7.0") },
  { version: "0.6.0", url: tag("0.6.0") },
  { version: "0.5.0", url: tag("0.5.0") },
  { version: "0.4.0", url: tag("0.4.0") },
  { version: "0.3.0", url: tag("0.3.0") },
];

/**
 * Numeric semver compare (handles 0.10.0 > 0.9.0, which string compare gets
 * wrong). Returns <0 if a<b, 0 if equal, >0 if a>b. Pre-release/build suffixes
 * are ignored — the catalog only keys off released x.y.z versions.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// The version the docs are currently filtered to. Defaults to the latest, so a
// first visit shows the full, current catalog. The dropdown writes this; the
// sidebar, footer, and obsolete banner read it.
const [selectedVersion, setSelectedVersion] = createSignal(CURRENT_VERSION);
export { selectedVersion, setSelectedVersion };
