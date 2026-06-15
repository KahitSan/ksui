// The version shown in the top-bar dropdown. After a new release, add the new
// entry to the top of VERSIONS and bump CURRENT_VERSION to match. See
// RELEASING.md at the repo root for the full rule.
export const CURRENT_VERSION = "0.4.0";

export type VersionEntry = {
  version: string;
  url: string;
};

// Newest first. Each url points at the GitHub release tag for that version.
export const VERSIONS: VersionEntry[] = [
  { version: "0.4.0", url: "https://github.com/KahitSan/ksui/releases/tag/v0.4.0" },
  { version: "0.3.0", url: "https://github.com/KahitSan/ksui/releases/tag/v0.3.0" },
];
