import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Asserts the "royal-violet" contributed theme in plugin.manifest.json
// (THEME-SPEC-V2.1-DYNAMIC-VARIANTS.md §1/§7.2/§8.2) validates against the
// same structural + per-token rules kernel/theme-registry.ts's
// validateContributedThemes() enforces at plugin-load time. This test stays
// self-contained (no import of kserp kernel source — see CLAUDE.md's
// "plugin never needs kserp source" rule) by re-checking the spec's own
// regex/cap contract directly against the manifest JSON; a mismatch here
// means the theme (or one variant of it) would silently be dropped or
// truncated when the real plugin loads.
const manifestPath = fileURLToPath(new URL("../../plugin.manifest.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// THEME-SPEC.md §2.2 `color` validator class — unchanged by the v2.1 addendum.
const isColor = (v: string): boolean =>
  /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ||
  /^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/i.test(v);

// §9.1 grammar — `(?!\d+$)` rejects an all-digit id so no variant key is ever
// enumerated as a JS integer-index property ahead of string-keyed siblings.
const VARIANT_ID_GRAMMAR = /^(?!\d+$)[a-z0-9-]{1,32}$/;
// §9.3 — plain-text label grammar, distinct from any CSS-value validator.
const LABEL_GRAMMAR = /^[A-Za-z0-9 '-]{1,60}$/;

// §1.2 allowlist — full 69-key canonical set, color-class tokens only listed
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
  "--ks-accent-selected-fg",
  "--ks-danger",
  "--ks-success",
  "--ks-input-border-focus",
  "--ks-focus-ring",
  "--ks-focus-ring-offset",
]);

// §7.2's final coverage table: royal-violet is the addendum's >2-variants
// proof — 3 variants, 2 distinct appearances.
const VARIANT_KEYS = ["dark", "light", "high-contrast"] as const;
// §1.2 — a bare "dark"/"light" key infers its own appearance; every other
// key (here, "high-contrast") must declare it explicitly.
const EXPECTED_APPEARANCE: Record<(typeof VARIANT_KEYS)[number], "dark" | "light"> = {
  dark: "dark",
  light: "light",
  "high-contrast": "dark",
};

// Relative-luminance WCAG contrast ratio (same formula the manifest's
// high-contrast values were tuned against — see the gate script referenced
// in the PR description) — cheap enough to assert inline, not just eyeball.
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function contrastRatio(hex1: string, hex2: string): number {
  const relLum = ([r, g, b]: [number, number, number]) => {
    const f = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [l1, l2] = [relLum(hexToRgb(hex1)), relLum(hexToRgb(hex2))];
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

describe("plugin.manifest.json contributes.themes (THEME-SPEC-V2.1-DYNAMIC-VARIANTS.md §1/§7.2/§8.2)", () => {
  it("declares exactly one contributed theme", () => {
    expect(manifest.contributes?.themes).toHaveLength(1);
  });

  const theme = manifest.contributes?.themes?.[0];

  it("uses id 'royal-violet', label 'Royal Violet', version '1.2.0'", () => {
    expect(theme.id).toBe("royal-violet");
    expect(theme.label).toBe("Royal Violet");
    expect(theme.version).toBe("1.2.0");
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

  it("declares a 'variants' object with exactly dark + light + high-contrast present (§1.3, §9.5 rule 3)", () => {
    expect(theme.variants).toBeTypeOf("object");
    expect(Object.keys(theme.variants).sort()).toEqual([...VARIANT_KEYS].sort());
  });

  it("stays within the 1-6 variant cap (§1.3)", () => {
    expect(Object.keys(theme.variants).length).toBeLessThanOrEqual(6);
  });

  for (const variant of VARIANT_KEYS) {
    describe(`variants.${variant}`, () => {
      const decl = theme.variants[variant];
      const tokens = decl.tokens as Record<string, string>;

      it("id matches the §9.1 variantId grammar", () => {
        expect(variant).toMatch(VARIANT_ID_GRAMMAR);
      });

      it("declares (or infers) the correct appearance (§1.2)", () => {
        const appearance = decl.appearance ?? (variant as "dark" | "light");
        expect(appearance).toBe(EXPECTED_APPEARANCE[variant]);
      });

      it("stays under the 20-token-per-map cap (§9.4)", () => {
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
    });
  }

  for (const variant of ["dark", "light"] as const) {
    it(`variants.${variant} carries hover/active states for primary and a matching focus ring`, () => {
      const tokens = theme.variants[variant].tokens as Record<string, string>;
      expect(tokens).toHaveProperty("--ks-primary-hover");
      expect(tokens).toHaveProperty("--ks-primary-active");
      expect(tokens).toHaveProperty("--ks-accent-hover");
      expect(tokens["--ks-focus-ring"]).toBe(tokens["--ks-accent"]);
      expect(tokens["--ks-input-border-focus"]).toBe(tokens["--ks-accent"]);
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

  // §7.2 — the >2-variants proof: a third face, distinct id, same violet
  // identity pushed to WCAG-AAA-adjacent contrast for low-vision/glare use.
  describe("variants['high-contrast'] (§7.2 — the >2-variants proof)", () => {
    const hc = theme.variants["high-contrast"];
    const tokens = hc.tokens as Record<string, string>;

    it("label passes the §9.3 plain-text grammar and reads 'High Contrast'", () => {
      expect(hc.label).toMatch(LABEL_GRAMMAR);
      expect(hc.label).toBe("High Contrast");
    });

    it("declares appearance 'dark' explicitly (§1.2 — required for a non-dark/light id)", () => {
      expect(hc.appearance).toBe("dark");
    });

    it("pushes to a near-black/near-white extreme, distinct from royal-violet:dark's mid-tone surfaces", () => {
      expect(tokens["--ks-bg"]).toBe("#000000");
      expect(tokens["--ks-fg"]).toBe("#ffffff");
      expect(tokens["--ks-bg"]).not.toBe(theme.variants.dark.tokens["--ks-bg"]);
    });

    it("stays in the violet/gold identity family (not a generic grayscale high-contrast)", () => {
      expect(tokens["--ks-primary"]).toMatch(/^#(?:c9a3ff|7c3aed|a78bfa)/i);
      expect(tokens["--ks-accent"]).toMatch(/^#(?:ffe066)/i);
    });

    // Body-text pairs are held to AAA (7:1); UI/large-text and non-text
    // pairs to AA (4.5:1 / 3:1) — this is what the gate script in the PR
    // description iterated the hex values above against.
    it("body-text pairs clear WCAG AAA (>=7:1)", () => {
      expect(contrastRatio(tokens["--ks-fg"], tokens["--ks-bg"])).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(tokens["--ks-fg-muted"], tokens["--ks-surface"])).toBeGreaterThanOrEqual(7);
    });

    it("UI/large-text and accent pairs clear WCAG AA (>=4.5:1)", () => {
      expect(contrastRatio(tokens["--ks-primary"], tokens["--ks-bg"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens["--ks-danger"], tokens["--ks-bg"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens["--ks-success"], tokens["--ks-bg"])).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(tokens["--ks-accent-selected-fg"], tokens["--ks-primary"]),
      ).toBeGreaterThanOrEqual(4.5);
    });
  });
});
