import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Asserts the "royal-violet" contributed theme in plugin.manifest.json
// (THEME-SPEC-V2-VARIANTS.md §1.1/§2.1) validates against the same
// structural + per-token rules kernel/theme-registry.ts's
// validateContributedThemes() enforces at plugin-load time. This test stays
// self-contained (no import of kserp kernel source — see CLAUDE.md's
// "plugin never needs kserp source" rule) by re-checking the spec's own
// regex/cap contract directly against the manifest JSON; a mismatch here
// means the theme would silently be dropped or truncated when the real
// plugin loads.
const manifestPath = fileURLToPath(new URL("../../plugin.manifest.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// THEME-SPEC.md §2.2 `color` validator class — unchanged by the v2 addendum.
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

const VARIANT_KEYS = ["dark", "light"] as const;

describe("plugin.manifest.json contributes.themes (THEME-SPEC-V2-VARIANTS.md §1.1/§7 Step 5)", () => {
  it("declares exactly one contributed theme", () => {
    expect(manifest.contributes?.themes).toHaveLength(1);
  });

  const theme = manifest.contributes?.themes?.[0];

  it("uses id 'royal-violet', label 'Royal Violet', version '1.1.0'", () => {
    expect(theme.id).toBe("royal-violet");
    expect(theme.label).toBe("Royal Violet");
    expect(theme.version).toBe("1.1.0");
  });

  it("no longer carries the removed v1 'base' field (§1.1)", () => {
    expect(theme).not.toHaveProperty("base");
  });

  it("id does not collide with a reserved built-in id", () => {
    expect(["dark", "light", "midnight-amber", "sepia"]).not.toContain(theme.id);
  });

  it("id matches the §4.3/§2.2 kebab-case themeId shape", () => {
    expect(theme.id).toMatch(/^[a-z0-9-]{1,64}$/);
  });

  it("declares a 'variants' object with exactly dark + light present (§6.3 rule 3)", () => {
    expect(theme.variants).toBeTypeOf("object");
    expect(Object.keys(theme.variants).sort()).toEqual([...VARIANT_KEYS].sort());
  });

  for (const variant of VARIANT_KEYS) {
    describe(`variants.${variant}`, () => {
      const tokens = theme.variants[variant].tokens as Record<string, string>;

      it("stays under the 20-token-per-map cap (§6.2)", () => {
        expect(Object.keys(tokens).length).toBeLessThanOrEqual(20);
      });

      it("every token key is a member of the §1.2 allowlist", () => {
        for (const key of Object.keys(tokens)) {
          expect(COLOR_TOKEN_ALLOWLIST.has(key), `unknown token key "${key}"`).toBe(true);
        }
      });

      it("every token value passes the §2.2 color validator and the 300-char cap", () => {
        for (const [key, value] of Object.entries(tokens)) {
          expect(isColor(value), `"${key}": "${value}" fails the color validator`).toBe(true);
          expect(value.length, `"${key}" exceeds the 300-char cap`).toBeLessThanOrEqual(300);
        }
      });

      it("carries hover/active states for primary and a matching focus ring", () => {
        expect(tokens).toHaveProperty("--ks-primary-hover");
        expect(tokens).toHaveProperty("--ks-primary-active");
        expect(tokens).toHaveProperty("--ks-accent-hover");
        expect(tokens["--ks-focus-ring"]).toBe(tokens["--ks-accent"]);
        expect(tokens["--ks-input-border-focus"]).toBe(tokens["--ks-accent"]);
      });
    });
  }

  it("dark variant lands in the violet family, far from the amber/gold brand default", () => {
    const dark = theme.variants.dark.tokens as Record<string, string>;
    expect(dark["--ks-primary"]).toBe("#7c3aed");
    expect(dark["--ks-accent"]).toBe("#a78bfa");
    // amber/gold hues (#c9a961 primary, #fbbf24 accent) must not appear.
    expect(dark["--ks-primary"]).not.toMatch(/#c9a961|#fbbf24/i);
    expect(dark["--ks-accent"]).not.toMatch(/#c9a961|#fbbf24/i);
  });

  it("light variant is a genuinely light surface with a readable dark-on-light primary (§7 Step 5)", () => {
    const light = theme.variants.light.tokens as Record<string, string>;
    expect(light["--ks-bg"]).toBe("#f7f3ff");
    expect(light["--ks-primary"]).toBe("#6d28d9");
    // the light bg must not be a re-used dark-variant surface value.
    expect(light["--ks-bg"]).not.toBe(theme.variants.dark.tokens["--ks-bg"]);
  });
});
