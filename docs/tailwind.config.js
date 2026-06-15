/** @type {import('tailwindcss').Config} */
export default {
  // Scan the docs pages, the examples, AND the real component source one folder
  // up, so every Tailwind class the components use gets generated.
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../src/**/*.{ts,tsx}"],
  // Preflight is Tailwind's global reset. The docs theme (styles.css) is hand
  // written and does not expect that reset, so we keep preflight off and add
  // only the one base rule the components need (see tailwind.css).
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};
