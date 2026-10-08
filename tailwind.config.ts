import type { Config } from "tailwindcss";

const c = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: c("bg"),
        surface: c("surface"),
        "surface-2": c("surface-2"),
        line: c("line"),
        fg: c("fg"),
        muted: c("muted"),
        accent: c("accent"),
        "accent-fg": c("accent-fg"),
        "accent-soft": c("accent-soft"),
        ok: c("ok"),
        "ok-soft": c("ok-soft"),
        warn: c("warn"),
        "warn-soft": c("warn-soft"),
        bad: c("bad"),
        "bad-soft": c("bad-soft"),
        info: c("info"),
        "info-soft": c("info-soft"),
        // adm Indicia brand + service palette, for module identity and charts.
        brand: {
          navy: "#010062",
          pale: "#F0F7F7",
          seagreen: "#97DBD9",
          sustainability: "#78C7AE",
          tech: "#FFB05B",
          data: "#EE4E62",
          talent: "#B776BC",
          riverblue: "#9DC5ED",
          purple: "#6A2DD3",
          indiblue: "#4896F7",
        },
      },
      fontFamily: {
        // Avenir Next is the brand face; Nunito Sans is the open fallback loaded via next/font.
        sans: ["'Avenir Next'", "var(--font-body)", "system-ui", "sans-serif"],
        display: ["'Avenir Next'", "var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(1,0,98,0.04), 0 1px 3px rgba(1,0,98,0.05)",
        raised: "0 8px 24px rgba(1,0,98,0.08), 0 2px 6px rgba(1,0,98,0.05)",
      },
    },
  },
  plugins: [],
} satisfies Config;
