import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

// SonarJS recommended (at error). This plugin ships an oversized UI
// god-file; the three structure/complexity rules below are inherent to that
// god-file and are deferred to the #37 god-file split (fully rewriting 100+
// nested ternaries/functions and decomposing 24 complex functions in a 285KB
// monolith IS that refactor, not a lint pass). Every OTHER recommended rule
// is enforced.
export default [
  { ignores: ["node_modules/**", "dist*/**", ".vinxi/**", "**/*.config.*", "**/*.d.ts"] },
  sonarjs.configs.recommended,
  { files: ["**/*.{ts,tsx}"], languageOptions: { parser: tseslint.parser } },
  {
    rules: {
      "sonarjs/no-nested-conditional": "off",
      "sonarjs/no-nested-functions": "off",
      "sonarjs/cognitive-complexity": "off",
    },
  },
];
