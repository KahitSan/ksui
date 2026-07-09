import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Asserts the "royal-violet" contributed theme in plugin.manifest.json
// (THEME-SPEC.md §4.3) validates against the same structural + per-token
// rules kernel/theme-registry.ts's validateContributedThemes() enforces at
// plugin-load time. This test stays self-contained (no import of kserp
// kernel source — see CLAUDE.md's "plugin never needs kserp source" rule)
// by re-checking the spec's own regex/cap contract directly against the
// manifest JSON; a mismatch here means the theme would silently be dropped
// or truncated when the real plugin loads.
const manifestPath = fileURLToPath(new URL("../../plugin.manifest.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// THEME-SPEC §2.2 `color` validator class.
const isColor = (v: string): boolean =>
  /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ||
  /^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/i.test(v);

// §1.2 allowlist — full 62-key canonical set, color-class tokens only listed
// here since royal-violet contributes color deltas exclusively.
const COLOR_TOKEN_ALLOWLIST = new Set([
  "--ks-bg",
  "--ks-bg-gradient-to",
  "--ks-surface",
  "--ks-surface-raised",
  "--ks-surface-sunken",
  "--ks-overlay",
  "--ks-overlay-surface",
  "--ks-fg",
  "--ks-fg-muted",
  "--ks-fg-subtle",
  "--ks-fg-on-primary",
  "--ks-fg-on-accent",
  "--ks-border",
  "--ks-border-strong",
  "--ks-border-subtle",
  "--ks-primary",
  "--ks-primary-hover",
  "--ks-primary-active",
  "--ks-accent",
  "--ks-accent-hover",
  "--ks-input-border-focus",
  "--ks-focus-ring",
  "--ks-focus-ring-offset",
]);

describe("plugin.manifest.json contributes.themes (THEME-SPEC §4.3)", () => {
  it("declares exactly one contributed theme", () => {
    expect(manifest.contributes?.themes).toHaveLength(1);
  });

  const theme = manifest.contributes?.themes?.[0];

  it("uses id 'royal-violet', label 'Royal Violet', base 'dark'", () => {
    expect(theme.id).toBe("royal-violet");
    expect(theme.label).toBe("Royal Violet");
    expect(theme.base).toBe("dark");
    expect(theme.version).toBe("1.0.0");
  });

  it("id does not collide with a reserved built-in id", () => {
    expect(["dark", "light", "midnight-amber", "sepia"]).not.toContain(theme.id);
  });

  it("id matches the §4.3/§2.2 kebab-case themeId shape", () => {
    expect(theme.id).toMatch(/^[a-z0-9-]{1,64}$/);
  });

  it("stays under the 20-token-per-theme cap (§4.3 rule 3)", () => {
    expect(Object.keys(theme.tokens).length).toBeLessThanOrEqual(20);
  });

  it("every token key is a member of the §1.2 allowlist", () => {
    for (const key of Object.keys(theme.tokens)) {
      expect(COLOR_TOKEN_ALLOWLIST.has(key), `unknown token key "${key}"`).toBe(true);
    }
  });

  it("every token value passes the §2.2 color validator and the 300-char cap", () => {
    for (const [key, value] of Object.entries(theme.tokens as Record<string, string>)) {
      expect(isColor(value), `"${key}": "${value}" fails the color validator`).toBe(true);
      expect(value.length, `"${key}" exceeds the 300-char cap`).toBeLessThanOrEqual(300);
    }
  });

  it("primary/accent land in the violet family, far from the amber/gold brand default", () => {
    expect(theme.tokens["--ks-primary"]).toBe("#7c3aed");
    expect(theme.tokens["--ks-accent"]).toBe("#a78bfa");
    // amber/gold hues (#c9a961 primary, #fbbf24 accent) must not appear.
    expect(theme.tokens["--ks-primary"]).not.toMatch(/#c9a961|#fbbf24/i);
    expect(theme.tokens["--ks-accent"]).not.toMatch(/#c9a961|#fbbf24/i);
  });

  it("carries hover/active states for primary and a matching focus ring", () => {
    expect(theme.tokens).toHaveProperty("--ks-primary-hover");
    expect(theme.tokens).toHaveProperty("--ks-primary-active");
    expect(theme.tokens).toHaveProperty("--ks-accent-hover");
    expect(theme.tokens["--ks-focus-ring"]).toBe(theme.tokens["--ks-accent"]);
    expect(theme.tokens["--ks-input-border-focus"]).toBe(theme.tokens["--ks-accent"]);
  });
});
