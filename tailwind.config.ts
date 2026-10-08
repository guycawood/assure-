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
      },
      fontFamily: {
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Arial Narrow", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
